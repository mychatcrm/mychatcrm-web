import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), simulate: vi.fn(), budget: vi.fn(), copy: vi.fn(), gate: vi.fn(),
  port: vi.fn(), updates: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[],
  run: {} as Record<string, unknown>, agent: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ rpc: m.rpc, from: m.from }) }));
vi.mock("@/lib/server/process-agent-turn-v2", () => ({ simulateAgentTurnV2: m.simulate }));
vi.mock("@/lib/server/agent-cta-scheduler", () => ({ createSimulationAgendaExecutionPort: m.port }));
vi.mock("@/lib/server/agent-test-lab/isolation", () => ({ inspectLabIsolatedAgent: m.copy }));
vi.mock("@/lib/server/agent-test-lab/preflight", () => {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])) : value;
  return { labFingerprint: (value: unknown) => JSON.stringify(sort(value)) };
});
vi.mock("@/lib/agent-test-lab/safety-policy", () => ({ requireCertifiedLabCapability: m.gate }));
vi.mock("@/lib/server/agent-test-lab/ai-budget", () => ({ withLabAiBudget: m.budget }));
import { tickSimulationLabRun } from "@/lib/server/agent-test-lab/simulation";
import { labFingerprint } from "@/lib/server/agent-test-lab/preflight";
const id="33333333-3333-4333-8333-333333333333", claim="44444444-4444-4444-8444-444444444444";
const request = () => ({ mode:"simulation",profile:"short",targetKind:"copy",tenantId:"source",agentId:"a",channel:"meta_cloud",
  scenario:{version:1,name:"Controlled",goal:"Reply",language:"ja",steps:[
    {kind:"text",text:"  こんにちは\n",expected:{type:"reply"}},{kind:"text",text:"はい",expected:{type:"reply"}}]},
  testerModel:"gpt-4o-mini",allowedEffects:[],originalConfirmed:false,reuseTestContext:false });
const decision = { reply:"こんにちは",authorization:{allowed:true},agendaBlocked:false,agenda:null,
  handoff:{triggered:false,reason:null},followUp:{enabled:false,wouldCreate:false,intervalMinutes:null},
  leadOutcome:null,externalApiLookups:[],media:{filenames:[]} };
beforeEach(() => {
  vi.resetAllMocks(); m.updates=[];m.history=[];
  m.agent={active:true,metadata:{systemPrompt:"Keep my exact instructions"}};
  m.run={id,mode:"simulation",status:"running",request:request(),simulation_state:{},isolated_agent_id:"copy",
    target_tenant_id:"tenant-lab-copy",target_agent_id:"lab-a",config_hash:labFingerprint(m.agent),scenario_hash:labFingerprint(request().scenario)};
  m.copy.mockResolvedValue({id:"copy",labTenantId:"tenant-lab-copy",labAgentId:"lab-a",stale:false,unavailable:[]});
  m.port.mockImplementation((options) => ({mode:"simulate",snapshotPendingAction:()=>options.pendingAction,records:[]}));
  m.budget.mockImplementation((_scope,fn)=>fn());m.simulate.mockResolvedValue({ok:true,decision});
  m.rpc.mockImplementation(async (name:string) => ({data:name==="claim_agent_test_lab_run_v1"?{claimToken:claim}:name.startsWith("begin_")?"step":true,error:null}));
  m.from.mockImplementation((table:string) => {
    let update:Record<string,unknown>|undefined;
    const result=()=>({data:table==="agent_test_lab_runs"?m.run:table==="tenant_agents"?m.agent:m.history,error:null});
    const q={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>result(),single:async()=>result(),
      update:(value:Record<string,unknown>)=>{update=value;m.updates.push(value);return q;},then:(fn:Function)=>Promise.resolve(fn({data:update?null:result().data,error:null}))};
    return q;
  });
});
describe("durable dry-run worker",()=>{
  it("executes exactly one step, reserves cost, and preserves chosen channel and prompt",async()=>{
    await tickSimulationLabRun(id);
    expect(m.simulate).toHaveBeenCalledTimes(1);
    expect(m.simulate).toHaveBeenCalledWith(expect.objectContaining({channel:"meta_cloud",model:"gpt-4o-mini",
      message:"  こんにちは\n",remoteJid:`simulation:${id}`,agent:expect.objectContaining({systemPrompt:"Keep my exact instructions"})}));
    expect(m.budget).toHaveBeenCalledWith({runId:id,claim,operation:"simulation:0",category:"agent_ai"},expect.any(Function));
    expect(m.rpc.mock.calls.map(x=>x[0])).toEqual(["claim_agent_test_lab_run_v1","begin_agent_test_lab_simulation_step_v5","complete_agent_test_lab_simulation_step_v5"]);
    expect(m.updates).toEqual([]);
  });
  it("restores the preceding turn and proposal instead of provisioning a new copy",async()=>{
    const pending={id:"simulation-pending-action",journey_id:null,action:"create",event_id:null,proposed_date:"2030-10-01",
      proposed_time:"14:00",proposed_location:null,timezone:"UTC",expires_at:"2030-10-01T13:00:00Z",conversation_sequence:null};
    m.run.simulation_state={nextOrdinal:1,pendingAction:pending};
    m.history=[{direction:"tester",content:"hello",provider_message_id:"sim:0:tester",provider_occurred_at:"2030-01-01T00:00:00Z"},
      {direction:"agent",content:"14:00?",provider_message_id:"sim:0:agent",provider_occurred_at:"2030-01-01T00:00:00Z"}];
    await tickSimulationLabRun(id);
    expect(m.port).toHaveBeenCalledWith({pendingAction:pending});
    expect(m.simulate.mock.calls[0][0].simulationContext.history.map((x:{content:string})=>x.content)).toEqual(["hello","14:00?"]);
    expect(m.rpc.mock.calls.at(-1)?.[1].p_pending).toEqual(pending);
  });
  it("stays idle without a claim",async()=>{m.rpc.mockResolvedValue({data:null,error:null});await tickSimulationLabRun(id);expect(m.from).not.toHaveBeenCalled();});
  it("rejects a wrongly routed worker",async()=>{m.run.mode="manual";await expect(tickSimulationLabRun(id)).rejects.toThrow("simulation_worker_mode_rejected");expect(m.simulate).not.toHaveBeenCalled();});
  it("stops without calling the model",async()=>{m.run.status="stopping";await tickSimulationLabRun(id);expect(m.simulate).not.toHaveBeenCalled();expect(m.updates[0].status).toBe("cancelled");});
  it.each(["copy","hash","gate","start","budget","engine","save"])("does not report success after %s failure",async failure=>{
    if(failure==="copy")m.copy.mockResolvedValue(null);
    if(failure==="hash")m.run.config_hash="changed";
    if(failure==="gate")m.gate.mockImplementation(()=>{throw new Error("paid_lab_execution_pending");});
    if(failure==="budget")m.budget.mockRejectedValue(new Error("lab_ai_budget_exhausted"));
    if(failure==="engine")m.simulate.mockResolvedValue({ok:false,error:"timeout"});
    if(failure==="start"||failure==="save")m.rpc.mockImplementation(async(name:string)=>({data:name==="claim_agent_test_lab_run_v1"?{claimToken:claim}:name.startsWith("begin_")?"step":true,
      error:(failure==="start"&&name.startsWith("begin_"))||(failure==="save"&&name.startsWith("complete_"))?{message:"failure"}:null}));
    await tickSimulationLabRun(id);
    expect(m.updates[0]).toMatchObject({status:"failed",verdict:"inconclusive"});
    expect(m.simulate.mock.calls.length).toBeLessThanOrEqual(1);
    if(["copy","hash","gate","start","budget"].includes(failure))expect(m.simulate).not.toHaveBeenCalled();
  });
  it("does not retry or overwrite pause after completion loses its claim",async()=>{
    m.rpc.mockImplementation(async(name:string)=>({data:name==="claim_agent_test_lab_run_v1"?{claimToken:claim}:name.startsWith("begin_")?"step":false,error:null}));
    await tickSimulationLabRun(id);expect(m.simulate).toHaveBeenCalledTimes(1);expect(m.updates).toEqual([]);
  });
  it("records missing dependencies as inconclusive",async()=>{
    m.copy.mockResolvedValue({id:"copy",labTenantId:"tenant-lab-copy",labAgentId:"lab-a",stale:false,unavailable:[{dependency:"calendar"}]});
    await tickSimulationLabRun(id);expect(m.rpc.mock.calls.at(-1)?.[1].p_result.verdict).toBe("inconclusive");
  });
  it("does not accelerate waits or spend AI on unsupported steps",async()=>{
    const r=request();r.scenario.steps[0]={kind:"wait",waitSeconds:60,expected:{type:"reply"}} as unknown as typeof r.scenario.steps[0];
    m.run.request=r;m.run.scenario_hash=labFingerprint(r.scenario);
    await tickSimulationLabRun(id);expect(m.budget).not.toHaveBeenCalled();expect(m.rpc.mock.calls.at(-1)?.[1].p_result.verdict).toBe("not_executed");
  });
});
