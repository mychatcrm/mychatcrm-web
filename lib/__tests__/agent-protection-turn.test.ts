import { beforeEach, describe, expect, it, vi } from "vitest";
const {record} = vi.hoisted(()=>({record:vi.fn()}));
vi.mock("@/lib/server/agent-protection-audit",()=>({recordAgentProtectionBlock:record}));
import { processAgentTurnV2 } from "@/lib/server/process-agent-turn-v2";
import { hasStructuredAgendaReadEvidence } from "@/lib/server/agent-cta-scheduler";
describe("protection does not bypass the turn decision",()=>{
  const params={sb:{},job:{id:"job-test",tenant_id:"tenant-test",agent_id:"agent-test",channel:"evolution"},transport:{channel:"meta_cloud"},generation:1} as unknown as Parameters<typeof processAgentTurnV2>[0];
  beforeEach(()=>{vi.resetAllMocks();record.mockResolvedValue(undefined);});
  it("audits a blocked turn without changing its result",async()=>{
    expect(await processAgentTurnV2(params)).toEqual({ok:false,error:"turn_transport_mismatch"});
    expect(record).toHaveBeenCalledWith(expect.objectContaining({jobId:"job-test",code:"turn_transport_mismatch"}));
  });
  it("does not create notifications during simulation",async()=>{
    await processAgentTurnV2({...params,dryRun:true});expect(record).not.toHaveBeenCalled();
  });
  it("rejects a mutating port even when the core dry-run entry point is used directly",async()=>{
    const result=await processAgentTurnV2({...params,dryRun:true,
      simulationContext:{history:[],agendaPort:{mode:"commit"} as never}});
    expect(result).toEqual({ok:false,error:"simulation_commit_port_rejected"});
    expect(record).not.toHaveBeenCalled();
  });
  it("does not convert a protection failure into permission when audit is unavailable",async()=>{
    record.mockRejectedValue(new Error("offline"));
    expect(await processAgentTurnV2(params)).toEqual({ok:false,error:"turn_transport_mismatch"});
  });
  it("does not restore the August 11 create-as-list regression even with quoted evidence",()=>{
    const text="Poderíamos agendar agora?";
    expect(hasStructuredAgendaReadEvidence({action:"list",date:null,time:null,location:null,eventId:null,readEvidence:text},text,
      {priorAssistantText:"Você pode agendar um horário?",timezone:"UTC"})).toBe(false);
  });
});
