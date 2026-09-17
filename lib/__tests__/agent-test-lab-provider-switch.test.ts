import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: unknown; count?: number };
const m = vi.hoisted(() => ({
  read: vi.fn<(table: string) => Result>(),
  exec: vi.fn<(table: string) => Result>(),
  calls: [] as { table: string; method: string; args: unknown[] }[],
  audit: vi.fn(),
  evoConfigured: vi.fn(), evoCreate: vi.fn(), evoFetch: vi.fn(), evoConnect: vi.fn(),
  evoDelete: vi.fn(), evoRemove: vi.fn(), evoLogout: vi.fn(), cloudHealth: vi.fn(),
  provision: vi.fn(), applySettings: vi.fn(), upsertCloud: vi.fn(), deleteCloud: vi.fn(), setProvider: vi.fn(),
}));

function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "in", "order", "limit", "neq", "insert", "update", "upsert", "delete"]) {
    q[method] = (...args: unknown[]) => { m.calls.push({ table, method, args }); return q; };
  }
  q.maybeSingle = async () => m.read(table);
  q.single = async () => m.read(table);
  q.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(m.exec(table)).then(resolve, reject);
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from: (table: string) => query(table) }) }));
vi.mock("@/lib/server/agent-test-lab/auth", () => ({ labAudit: m.audit, labHash: (value: string) => `hash:${value}` }));
vi.mock("@/lib/integrations/evolution-api", () => ({
  isEvolutionApiConfigured: m.evoConfigured, evolutionCreateInstance: m.evoCreate, evolutionFetchInstances: m.evoFetch,
  evolutionInstanceConnect: m.evoConnect, evolutionDeleteInstance: m.evoDelete, evolutionLogoutInstance: m.evoLogout,
  evolutionRemoveInstanceCompletely: m.evoRemove,
  applyClientEvolutionInstanceSettings: m.applySettings, CLIENT_EVOLUTION_INSTANCE_SETTINGS: {},
}));
vi.mock("@/lib/integrations/evolution-connect-qr", () => ({
  normalizeInstanceConnectToQrDataUrl: (payload: { qr?: string }) => payload?.qr ?? null,
}));
vi.mock("@/lib/integrations/evolution-webhook-url", () => ({ buildEvolutionWebhookUrl: () => "https://lab.invalid/hook" }));
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({ checkWhatsAppCloudConnectionHealth: m.cloudHealth }));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  upsertWhatsAppCloudConnection: m.upsertCloud, deleteWhatsAppCloudConnection: m.deleteCloud,
}));
vi.mock("@/lib/server/whatsapp-slot-provider", () => ({ setSlotActiveProvider: m.setProvider }));
vi.mock("@/lib/server/agent-test-lab/isolation", () => ({
  provisionLabIsolatedAgent: m.provision,
  labTenantIdFor: (tenantId: string, agentId: string) => `tenant-lab-${tenantId}-${agentId}`,
}));

import { switchLabSenderProvider, connectLabMetaSender, connectLabSender } from "@/lib/server/agent-test-lab/connections";
import { switchLabReceiverProvider } from "@/lib/server/agent-test-lab/receiver";

const EVOLUTION_SENDER = { id: "sender-1", instance_name: "mychatcrm-lab-sender-1", provider: "evolution",
  state: "open", wa_jid: "447700900001@s.whatsapp.net", webhook_secret_hash: "hash", updated_at: "2026-09-15T00:00:00.000Z" };
const META_SENDER = { ...EVOLUTION_SENDER, instance_name: "mychatcrm-lab-meta-sender-1", provider: "meta_cloud",
  phone_number_id: "phone-1", waba_id: "waba-1", access_token: "token", display_phone: "+44 7700 900001" };
const EVOLUTION_RECEIVER = { id: "receiver-1", instance_name: "mychatcrm-lab-receiver-1", provider: "evolution",
  state: "open", wa_jid: "447700900002@s.whatsapp.net", webhook_secret_hash: "hash", updated_at: "2026-09-15T00:00:00.000Z" };
const META_RECEIVER = { ...EVOLUTION_RECEIVER, instance_name: "mychatcrm-lab-meta-receiver-1", provider: "meta_cloud",
  phone_number_id: "phone-2", waba_id: "waba-1", access_token: "token", display_phone: "+44 7700 900002" };

/** Serves the laboratory connection row until this laboratory archives it. */
function connectionRow(initial: Record<string, unknown> | null, afterArchive: Record<string, unknown> | null = null) {
  return () => {
    const archived = m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "update"
      && (call.args[0] as Record<string, unknown>)?.archived_at);
    return { data: archived ? afterArchive : initial, error: null };
  };
}
const archivedConnections = () => m.calls.filter(call => call.table === "agent_test_lab_connections"
  && call.method === "update" && (call.args[0] as Record<string, unknown>)?.archived_at);

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  process.env.AGENT_TEST_LAB_PUBLIC_URL = "https://lab.invalid";
  process.env.MYCHATCRM_PUBLIC_BASE_URL = "https://lab.invalid";
  process.env.EVOLUTION_WEBHOOK_SECRET = "secret";
  m.evoConfigured.mockReturnValue(true);
  m.evoCreate.mockResolvedValue({ ok: true, data: {} });
  m.evoConnect.mockResolvedValue({ ok: true, data: { qr: "data:image/png;base64,QUJD" } });
  m.evoDelete.mockResolvedValue({ ok: true });
  m.evoRemove.mockResolvedValue({ verifiedAbsent: true });
  m.evoLogout.mockResolvedValue({ ok: true });
  m.applySettings.mockResolvedValue({ ok: true });
  m.upsertCloud.mockResolvedValue({ error: null });
  m.deleteCloud.mockResolvedValue({ error: null });
  m.setProvider.mockResolvedValue({ error: null });
  m.provision.mockResolvedValue({ labTenantId: "tenant-lab-t1-a1", labAgentId: "lab-a1", unavailable: [] });
  m.cloudHealth.mockResolvedValue({ ok: true, displayPhoneNumber: "+44 7700 900001", verifiedName: "Lab" });
  // A removed Evolution instance is gone from the inventory; a fresh one is connecting.
  m.evoFetch.mockResolvedValue({ ok: true, data: [] });
  m.exec.mockReturnValue({ error: null, count: 0 });
  m.read.mockReturnValue({ data: null, error: null });
});

describe("tester line: Evolution to Meta", () => {
  it("removes only the laboratory Evolution link, audits it and leaves the Meta signup to the browser", async () => {
    m.read.mockImplementation(table => table === "agent_test_lab_connections"
      ? connectionRow(EVOLUTION_SENDER)() : { data: null, error: null });
    const result = await switchLabSenderProvider("meta_cloud");
    expect(result).toEqual({ switched: true, connection: null, qr: null });
    expect(m.evoRemove).toHaveBeenCalledWith("mychatcrm-lab-sender-1");
    expect(m.audit.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      "sender.provider_switch_requested", "sender.disconnect_requested", "sender.provider_switched",
    ]));
    // Nothing new was opened here: the Meta credential only exists after the signup.
    expect(m.evoCreate).not.toHaveBeenCalled();
  });
  it("refuses the swap while a test is open and never touches the provider", async () => {
    m.read.mockImplementation(table => table === "agent_test_lab_connections" ? { data: EVOLUTION_SENDER, error: null } : { data: null, error: null });
    m.exec.mockImplementation(table => table === "agent_test_lab_runs" ? { error: null, count: 1 } : { error: null, count: 0 });
    await expect(switchLabSenderProvider("meta_cloud")).rejects.toThrow("sender_has_active_runs");
    expect(m.evoLogout).not.toHaveBeenCalled();
    expect(archivedConnections()).toHaveLength(0);
  });
  it("does not open a new connection when the disconnect is not confirmed", async () => {
    m.read.mockImplementation(table => table === "agent_test_lab_connections" ? { data: EVOLUTION_SENDER, error: null } : { data: null, error: null });
    m.evoRemove.mockResolvedValue({ verifiedAbsent: false });
    await expect(switchLabSenderProvider("meta_cloud")).rejects.toThrow("sender_removal_unconfirmed");
    expect(archivedConnections()).toHaveLength(0);
    expect(m.evoCreate).not.toHaveBeenCalled();
    expect(m.evoConnect).not.toHaveBeenCalled();
  });
  it("stops when the row survives the archive, instead of connecting on top of it", async () => {
    m.read.mockImplementation(table => table === "agent_test_lab_connections" ? { data: EVOLUTION_SENDER, error: null } : { data: null, error: null });
    await expect(switchLabSenderProvider("meta_cloud")).rejects.toThrow("sender_switch_unconfirmed");
  });
});

describe("tester line: Meta to Evolution", () => {
  it("archives the Meta credential and returns the QR of a new laboratory instance", async () => {
    const created = { ...EVOLUTION_SENDER, id: "sender-2", state: "connecting", wa_jid: null };
    const reserved = () => m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "insert");
    m.read.mockImplementation(table => {
      if (table !== "agent_test_lab_connections") return { data: null, error: null };
      if (archivedConnections().length === 0) return { data: META_SENDER, error: null };
      return { data: reserved() ? created : null, error: null };
    });
    m.evoFetch.mockImplementation(async () => reserved()
      ? { ok: true, data: [{ name: created.instance_name, connectionStatus: "connecting" }] }
      : { ok: true, data: [] });
    const result = await switchLabSenderProvider("evolution");
    expect(result.switched).toBe(true);
    expect(result.qr).toBe("data:image/png;base64,QUJD");
    // A Meta number stays registered with its WABA; only the laboratory copy goes.
    expect(m.evoRemove).not.toHaveBeenCalledWith("mychatcrm-lab-meta-sender-1");
    expect(m.evoCreate).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls.map(call => call[0])).toContain("sender.provider_switched");
  });
  it("does nothing when the line already uses the chosen provider", async () => {
    m.read.mockImplementation(table => table === "agent_test_lab_connections" ? { data: META_SENDER, error: null } : { data: null, error: null });
    const result = await switchLabSenderProvider("meta_cloud");
    expect(result.switched).toBe(false);
    expect(m.evoLogout).not.toHaveBeenCalled();
    expect(archivedConnections()).toHaveLength(0);
  });
});

describe("tester line: QR recovery", () => {
  it("uses the QR returned by instance creation without requiring a second provider call", async () => {
    const created = { ...EVOLUTION_SENDER, id: "sender-2", state: "connecting", wa_jid: null };
    m.read.mockImplementation(table => table === "agent_test_lab_connections"
      ? { data: m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "insert") ? created : null, error: null }
      : { data: null, error: null });
    m.evoCreate.mockResolvedValue({ ok: true, data: { qr: "data:image/png;base64,QUJD" } });

    const result = await connectLabSender();
    expect(result.qr).toBe("data:image/png;base64,QUJD");
    expect(m.evoConnect).not.toHaveBeenCalled();
    expect(m.evoFetch).not.toHaveBeenCalled();
  });

  it("asks the newly created instance for its QR before reading an eventually consistent inventory", async () => {
    const created = { ...EVOLUTION_SENDER, id: "sender-2", state: "connecting", wa_jid: null };
    m.read.mockImplementation(table => table === "agent_test_lab_connections"
      ? { data: m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "insert") ? created : null, error: null }
      : { data: null, error: null });
    const result = await connectLabSender();
    expect(result.qr).toBe("data:image/png;base64,QUJD");
    expect(m.evoConnect).toHaveBeenCalledTimes(1);
    expect(m.evoFetch).not.toHaveBeenCalled();
  });

  it("releases an exact missing laboratory instance and creates a fresh QR", async () => {
    const fresh = { ...EVOLUTION_SENDER, id: "sender-2", state: "connecting", wa_jid: null };
    m.read.mockImplementation(table => {
      if (table !== "agent_test_lab_connections") return { data: null, error: null };
      if (!archivedConnections().length) return { data: EVOLUTION_SENDER, error: null };
      return { data: m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "insert") ? fresh : null, error: null };
    });
    m.evoFetch.mockResolvedValue({ ok: false, status: 404, error: "not found" });
    m.evoCreate.mockResolvedValue({ ok: true, data: { qr: "data:image/png;base64,QUJD" } });

    const result = await connectLabSender();
    expect(result.qr).toBe("data:image/png;base64,QUJD");
    expect(m.evoRemove).toHaveBeenCalledWith(EVOLUTION_SENDER.instance_name);
    expect(m.evoCreate).toHaveBeenCalledTimes(1);
  });
});

describe("tester line: number collisions", () => {
  const credentials = { phoneNumberId: "phone-9", wabaId: "waba-9", accessToken: "token",
    displayPhone: "+44 7700 900009", verifiedName: "Lab", webhookSubscribed: true, phoneRegistered: true };
  it("refuses a number that belongs to a customer connection", async () => {
    m.read.mockReturnValue({ data: null, error: null });
    m.exec.mockImplementation(table => table === "whatsapp_cloud_connections" ? { error: null, count: 1 } : { error: null, count: 0 });
    await expect(connectLabMetaSender(credentials)).rejects.toThrow("sender_number_already_in_use");
    expect(m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "insert")).toBe(false);
  });
  it("refuses the number the isolated copy already answers on", async () => {
    // First read is the tester row (none); the second is the copy's own line.
    let reads = 0;
    m.read.mockImplementation(table => table === "agent_test_lab_connections"
      ? { data: reads++ === 0 ? null : { id: "receiver-1" }, error: null } : { data: null, error: null });
    await expect(connectLabMetaSender(credentials)).rejects.toThrow("sender_number_already_in_use");
  });
});

describe("isolated copy line", () => {
  it("swaps from Meta to Evolution, keeping the copy and its own rule", async () => {
    const created = { ...EVOLUTION_RECEIVER, id: "receiver-2", state: "connecting", wa_jid: null };
    const reserved = () => m.calls.some(call => call.table === "agent_test_lab_connections" && call.method === "insert");
    m.read.mockImplementation(table => {
      if (table === "agent_test_lab_connections") {
        if (archivedConnections().length === 0) return { data: META_RECEIVER, error: null };
        return { data: reserved() ? created : null, error: null };
      }
      if (table === "tenant_evolution_instances") return { data: { id: "route-1", tenant_id: "tenant-lab-t1-a1", organic_agent_id: "lab-a1" }, error: null };
      if (table === "whatsapp_cloud_connections") return { data: { phone_number_id: "phone-2", tenant_id: "tenant-lab-t1-a1" }, error: null };
      if (table === "agent_test_lab_isolated_agents") return { data: { lab_agent_id: "lab-a1" }, error: null };
      if (table === "lead_distribution_rules") return { data: { id: "rule-1" }, error: null };
      return { data: null, error: null };
    });
    m.evoFetch.mockImplementation(async () => reserved()
      ? { ok: true, data: [{ name: created.instance_name, connectionStatus: "connecting" }] }
      : { ok: true, data: [] });
    const result = await switchLabReceiverProvider("evolution", "t1", "a1");
    expect(result.switched).toBe(true);
    expect(result.qr).toBe("data:image/png;base64,QUJD");
    expect(m.deleteCloud).toHaveBeenCalledWith("tenant-lab-t1-a1", 0);
    expect(m.provision).toHaveBeenCalledWith("t1", "a1");
    expect(m.audit.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      "receiver.provider_switch_requested", "receiver.provider_switched",
    ]));
  });
  it("swaps from Evolution to Meta and stops before the signup", async () => {
    m.read.mockImplementation(table => {
      if (table === "agent_test_lab_connections") return connectionRow(EVOLUTION_RECEIVER)();
      if (table === "tenant_evolution_instances") return { data: { id: "route-1", tenant_id: "tenant-lab-t1-a1", organic_agent_id: "lab-a1" }, error: null };
      return { data: null, error: null };
    });
    const result = await switchLabReceiverProvider("meta_cloud", "t1", "a1");
    expect(result).toMatchObject({ switched: true, connection: null, qr: null, copy: null });
    expect(m.evoRemove).toHaveBeenCalledWith("mychatcrm-lab-receiver-1");
    expect(m.upsertCloud).not.toHaveBeenCalled();
  });
  it("refuses to swap the copy line while a test is open", async () => {
    m.read.mockImplementation(table => table === "agent_test_lab_connections" ? { data: EVOLUTION_RECEIVER, error: null } : { data: null, error: null });
    m.exec.mockImplementation(table => table === "agent_test_lab_runs" ? { error: null, count: 1 } : { error: null, count: 0 });
    await expect(switchLabReceiverProvider("meta_cloud", "t1", "a1")).rejects.toThrow("receiver_has_active_runs");
    expect(m.evoDelete).not.toHaveBeenCalled();
    expect(m.deleteCloud).not.toHaveBeenCalled();
  });
});
