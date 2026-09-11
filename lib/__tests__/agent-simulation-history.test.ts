import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({generate:vi.fn(),memory:vi.fn()}));
vi.mock("@/lib/ai/gateway",()=>({generateAIResponse:m.generate}));
vi.mock("@/lib/agents/inference-store",()=>({getInferenceProfileByTenantAgent:async()=>({
  metadata:{instructionMode:"pro",systemPrompt:"Answer using only the configured instructions.",idioma:"Automático"},model:"gpt-4o-mini"})}));
vi.mock("@/lib/server/lead-conversation-memory",()=>({buildLeadConversationMemory:m.memory}));
vi.mock("@/lib/server/agent-agenda-context",()=>({buildAgentAgendaContextBlock:async()=>""}));
import { generateAgentResponse } from "@/lib/ai/generate-agent-response";
const history=[{role:"user" as const,content:"  日本語 العربية\n"},{role:"assistant" as const,content:"What time?"}];
const input={tenantId:"tenant-lab-history",agentId:"lab-agent",feature:"agent_chat" as const,
  messages:[{role:"user" as const,content:"Tomorrow"}],conversationId:"simulation:fixture",simulationHistory:history};
beforeEach(()=>{
  vi.clearAllMocks();
  m.generate.mockResolvedValue({ok:true,text:"Please specify the time.",provider:"openai",model:"gpt-4o-mini",usage:{input:0,output:0,total:0}});
  m.memory.mockResolvedValue({state:null,lead:null,summary:null,recentMessages:[],knowledgeSnippets:[],outboundMediaLines:[],
    aiMessages:[{role:"user",content:"DATABASE_HISTORY"}],condensedContext:"",recognitionHint:null,lastInteractionAt:null});
});
describe("dry-run history boundary",()=>{
  it("passes laboratory user/assistant bytes to the model without reading a real conversation",async()=>{
    const result=await generateAgentResponse({...input,simulation:true});expect(result.ok).toBe(true);
    expect(m.memory).toHaveBeenCalledWith(expect.objectContaining({remoteJid:null}));
    const messages=m.generate.mock.calls[0][0].messages;
    for(const message of history)expect(messages).toContainEqual(expect.objectContaining(message));
    expect(JSON.stringify(messages)).not.toContain("DATABASE_HISTORY");
  });
  it("ignores laboratory history entirely for real production generation",async()=>{
    await generateAgentResponse({...input,simulation:false});
    expect(m.memory).toHaveBeenCalledWith(expect.objectContaining({remoteJid:"simulation:fixture"}));
    const messages=m.generate.mock.calls[0][0].messages;
    expect(messages).toContainEqual(expect.objectContaining({role:"user",content:"DATABASE_HISTORY"}));
    expect(messages).not.toContainEqual(expect.objectContaining(history[0]));
  });
});
