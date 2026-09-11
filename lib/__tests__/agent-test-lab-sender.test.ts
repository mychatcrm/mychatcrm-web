import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sender: vi.fn(), text: vi.fn(), media: vi.fn(), audio: vi.fn(), sign: vi.fn(),
  wait: vi.fn(), authorize: vi.fn(), rows: {} as Record<string, { data: unknown; error: unknown }> }));
vi.mock("@/lib/server/agent-test-lab/connections", () => ({ getLabSender: m.sender }));
vi.mock("@/lib/server/agent-test-lab/assets-store", () => ({ signLabAsset: m.sign }));
vi.mock("@/lib/integrations/evolution-api", () => ({ evolutionSendText: m.text, evolutionSendMedia: m.media,
  evolutionSendAudio: m.audio, evolutionWaitForMessageStatus: m.wait, jidToDigits: (s: string) => s.split("@")[0] }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => m.rows[table] }; return q;
} }) }));
import { dispatchLabText, dispatchLabMedia, assertLabDestinationAuthorized } from "@/lib/server/agent-test-lab/sender";
const target = "447700900001@s.whatsapp.net";
const destination = { tenantId: "tenant-lab-fixture", connectionId: "connection", channel: "evolution", targetJid: target, authorizeDispatch: m.authorize };
beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue(true);
  m.sender.mockResolvedValue({ state: "open", instance_name: "mychatcrm-lab-sender-fixture", wa_jid: "447700900002@s.whatsapp.net" });
  m.rows = { agent_test_lab_destinations: { data: { id: "authorized" }, error: null },
    tenant_evolution_instances: { data: { wa_jid: target, connection_state: "open" }, error: null },
    whatsapp_cloud_connections: { data: { display_phone: "+44 7700 900001", active: true }, error: null } };
  m.text.mockResolvedValue({ ok: true, data: { key: { id: "receipt" }, status: "SERVER_ACK" } });
  m.media.mockResolvedValue({ ok: true, data: { key: { id: "receipt" } } });
  m.wait.mockResolvedValue({ status: "DELIVERY_ACK" });
  m.sign.mockResolvedValue({ url: "https://signed.invalid/asset", asset: { kind: "image", mimeType: "image/png", filename: "controlled.png" } });
});
describe("laboratory transport identity", () => {
  it("rechecks the exact connected number, for both transports", async () => {
    expect(await assertLabDestinationAuthorized(destination)).toBe(true);
    expect(await assertLabDestinationAuthorized({ ...destination, channel: "meta_cloud" })).toBe(true);
    expect(await assertLabDestinationAuthorized({ ...destination, channel: "unknown" })).toBe(false);
  });
  it("rejects a revoked destination", async () => {
    m.rows.agent_test_lab_destinations.data = null;
    expect(await dispatchLabText({ ...destination, text: "Hello" })).toMatchObject({ outcome: "rejected" });
    expect(m.text).not.toHaveBeenCalled();
  });
  it.each([null, { wa_jid: "447700900003@s.whatsapp.net", connection_state: "open" }, { wa_jid: target, connection_state: "close" }])("rejects reconnected/disconnected/missing identity", async row => {
    m.rows.tenant_evolution_instances.data = row;
    expect(await dispatchLabText({ ...destination, text: "Hello" })).toMatchObject({ outcome: "rejected", code: "destination_not_authorized" });
    expect(m.text).not.toHaveBeenCalled();
  });
  it("fails closed on connection read errors", async () => {
    m.rows.tenant_evolution_instances.error = { message: "failure" };
    await expect(dispatchLabText({ ...destination, text: "Hello" })).rejects.toThrow("destination_connection_read_failed");
    expect(m.text).not.toHaveBeenCalled();
  });
  it("uses no system or customer instance for media", async () => {
    m.sender.mockResolvedValue({ state: "open", instance_name: "system-alerts", wa_jid: "447700900002@s.whatsapp.net" });
    expect(await dispatchLabMedia({ ...destination, assetId: "asset" })).toMatchObject({ outcome: "rejected", code: "sender_identity_invalid" });
    expect(m.sign).not.toHaveBeenCalled(); expect(m.media).not.toHaveBeenCalled();
  });
  it("never truncates a scripted message or caption silently", async () => {
    expect(await dispatchLabText({ ...destination, text: "x".repeat(4001) })).toMatchObject({ code: "message_length_invalid" });
    expect(await dispatchLabMedia({ ...destination, assetId: "asset", caption: "x".repeat(1001) })).toMatchObject({ code: "caption_length_invalid" });
    expect(m.text).not.toHaveBeenCalled(); expect(m.media).not.toHaveBeenCalled();
    await dispatchLabText({ ...destination, text: "こんにちは\n  keep spacing" });
    expect(m.text).toHaveBeenCalledWith(expect.objectContaining({ text: "こんにちは\n  keep spacing", number: "447700900001", resolveRecipient: false }));
  });
  it("does not retry an uncertain send", async () => {
    m.text.mockRejectedValue(new Error("timeout"));
    expect(await dispatchLabText({ ...destination, text: "Hello" })).toMatchObject({ outcome: "inconclusive" });
    expect(m.text).toHaveBeenCalledTimes(1);
  });
  it("honors a pause/stop that wins immediately before transport, including media", async () => {
    m.authorize.mockResolvedValue(false);
    expect(await dispatchLabText({ ...destination, text: "Hello" })).toMatchObject({ code: "dispatch_revoked" });
    expect(await dispatchLabMedia({ ...destination, assetId: "asset" })).toMatchObject({ code: "dispatch_revoked" });
    expect(m.text).not.toHaveBeenCalled(); expect(m.media).not.toHaveBeenCalled();
  });
});
