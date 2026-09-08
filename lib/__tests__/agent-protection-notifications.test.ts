import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, owner, apiKey } = vi.hoisted(() => ({ rpc:vi.fn(),owner:vi.fn(),apiKey:vi.fn() }));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServiceClient:()=>({rpc})}));
vi.mock("@/lib/server/admin-auth-db",()=>({getAdminSessionByIdFromDb:owner}));
vi.mock("@/lib/server/resend-config",()=>({getResendApiKey:apiKey}));
import { processAgentProtectionNotifications,protectionNotificationText } from "@/lib/server/agent-protection-notifications";
import { OPERATIONAL_AUDIT_OWNER_ADMIN_ID } from "@/lib/admin-operational-audit-access";
import { sanitizeOperationalAuditValue } from "@/lib/server/operational-audit";

describe("owner protection notifications",()=>{
  const row={id:"a-queue-id",claim_token:"a-claim",reason_code:"human_takeover",tenant_id:"private-tenant",agent_id:"private-agent",trace_id:"private-trace"};
  beforeEach(()=>{
    vi.resetAllMocks(); apiKey.mockReturnValue("synthetic-key"); owner.mockResolvedValue({email:"owner@example.test",adminId:OPERATIONAL_AUDIT_OWNER_ADMIN_ID,role:"super_admin"});
    rpc.mockImplementation(async(name:string)=>name==="claim_agent_protection_notifications_v1"?{data:[row],error:null}:{data:true,error:null});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}",{status:200})));
  });
  it("sends only fixed copy to the SaaS owner and records provider acceptance",async()=>{
    expect(await processAgentProtectionNotifications()).toMatchObject({sent:1,retry:0});
    expect(owner).toHaveBeenCalledWith(OPERATIONAL_AUDIT_OWNER_ADMIN_ID);
    const request=vi.mocked(fetch).mock.calls[0][1]!;
    const body=JSON.parse(request.body as string);
    expect(body.to).toEqual(["owner@example.test"]);
    expect(body.text).toContain("atendimento humano");
    expect(JSON.stringify(body)).not.toMatch(/private-tenant|private-agent|private-trace|a-queue-id/);
    expect(request.headers).toMatchObject({"Idempotency-Key":"agent-protection/a-queue-id"});
    expect(rpc).toHaveBeenCalledWith("finish_agent_protection_notification_v1",expect.objectContaining({p_ok:true,p_claim:"a-claim"}));
  });
  it.each([429,500,403])("provider %i remains a retry, never successful delivery",async(status)=>{
    vi.mocked(fetch).mockResolvedValue(new Response("{}",{status}));
    expect(await processAgentProtectionNotifications()).toMatchObject({sent:0,retry:1});
    expect(rpc).toHaveBeenCalledWith("finish_agent_protection_notification_v1",expect.objectContaining({p_ok:false,p_code:`notification_http_${status}`}));
  });
  it("network failure releases the claim for retry",async()=>{
    vi.mocked(fetch).mockRejectedValue(new Error("timeout with private data"));
    expect(await processAgentProtectionNotifications()).toMatchObject({sent:0,retry:1});
    expect(rpc).toHaveBeenCalledWith("finish_agent_protection_notification_v1",expect.objectContaining({p_ok:false,p_code:"notification_request_failed"}));
  });
  it("does not substitute any customer address when owner lookup fails",async()=>{
    owner.mockResolvedValue(null); await processAgentProtectionNotifications();
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("finish_agent_protection_notification_v1",expect.objectContaining({p_ok:false,p_code:"owner_destination_missing"}));
  });
  it("refuses a non-owner identity even if the lookup unexpectedly returns it",async()=>{
    owner.mockResolvedValue({email:"customer@example.test",adminId:"another-admin",role:"admin"});
    await processAgentProtectionNotifications(); expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves technical delivery codes while redacting private addresses",()=>{
    expect(sanitizeOperationalAuditValue({deliveryCode:"notification_http_500",email:"customer@example.test"}))
      .toEqual({deliveryCode:"notification_http_500",email:"[redacted]"});
    expect(protectionNotificationText("secret customer@example.test")).not.toContain("customer@example.test");
  });
  it("claim read failure performs no notification",async()=>{
    rpc.mockResolvedValue({error:{code:"offline"},data:null});
    expect(await processAgentProtectionNotifications()).toMatchObject({code:"protection_queue_read_failed"});
    expect(fetch).not.toHaveBeenCalled();
  });
});
