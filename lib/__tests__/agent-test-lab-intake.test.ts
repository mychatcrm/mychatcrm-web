import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ rpc: m.rpc }) }));
import { acceptsLabReceiverMessage } from "@/lib/server/agent-test-lab/intake";
const input = { tenantId: "tenant-lab-fixture", instanceName: "mychatcrm-lab-receiver-fixture", connectionId: "connection",
  remoteJid: "447700900001@s.whatsapp.net", providerTime: "2026-09-10T08:00:00Z", messageId: "message" };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AGENT_TEST_LAB_ENABLED", "true"); m.rpc.mockResolvedValue({ data: true, error: null }); });
describe("isolated receiver admission", () => {
  it("leaves every customer webhook unchanged without a database call", async () => {
    expect(await acceptsLabReceiverMessage({ ...input, tenantId: "customer", instanceName: "customer-instance" })).toBe(true);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([{ tenantId: "customer" }, { instanceName: "customer-instance" }, { messageId: null }, { providerTime: null }, { providerTime: "invalid" }])("rejects incomplete or mismatched laboratory scope", async override => {
    expect(await acceptsLabReceiverMessage({ ...input, ...override })).toBe(false); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("requires exact database approval, not a truthy response", async () => {
    expect(await acceptsLabReceiverMessage(input)).toBe(true);
    for (const data of [false, null, "true", { ok: true }]) {
      m.rpc.mockResolvedValue({ data, error: null }); expect(await acceptsLabReceiverMessage(input)).toBe(false);
    }
  });
  it("blocks lab intake when its feature is off", async () => {
    vi.stubEnv("AGENT_TEST_LAB_ENABLED", "false"); expect(await acceptsLabReceiverMessage(input)).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("never falls through to the agent if the authorization query fails", async () => {
    m.rpc.mockResolvedValue({ data: true, error: { message: "database unavailable" } });
    await expect(acceptsLabReceiverMessage(input)).rejects.toThrow("lab_inbound_authorization_unavailable");
  });
});
