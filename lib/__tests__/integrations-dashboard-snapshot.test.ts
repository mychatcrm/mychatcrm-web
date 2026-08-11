import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ rpc }),
}));

import { loadIntegrationsDashboardSnapshot } from "@/lib/server/integrations-dashboard-snapshot";

const session = {
  token: "test",
  tenantId: "tenant-a",
  email: "owner@example.test",
  displayName: "Owner",
  companyName: "Tenant A",
  plan: "solo" as const,
  planLabel: "Solo" as const,
  initials: "OW",
  status: "ativa" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    error: null,
    data: {
      version: 1,
      generated_at: "2026-08-11T09:00:00.000Z",
      whatsapp: {
        extra_slots: 1,
        offer: { amount_cents: 4990, currency: "brl", interval_unit: "month" },
        slot_states: [{ slot_index: 0, active_provider: "cloud_api", purpose: "forms" }],
        evolution: [{ id: "evo-1", slot_index: 0, instance_name: "safe-name", connection_state: "open", wa_jid: "5511999999999@s.whatsapp.net", updated_at: "2026-08-11T09:00:00Z" }],
        cloud: [{ phone_number_id: "phone-1", slot_index: 0, display_phone: "+55 11 99999-9999", verified_name: "Conta", active: true, updated_at: "2026-08-11T09:00:00Z" }],
      },
      meta: {
        grant: { discovery_status: "ready", last_error_code: null },
        pages: [{ page_id: "page-1", page_name: "Página", connected_at: "2026-08-11T09:00:00Z", health_status: "ready", health_code: null, health_message: null, lead_access_status: "verified_by_delivery", last_lead_access_verified_at: "2026-08-11T09:00:00Z", last_verified_at: "2026-08-11T09:00:00Z", last_webhook_at: null, subscribed_fields: ["leadgen"] }],
        rules: [{ page_id: "page-1", included_form_ids: ["form-1"], excluded_form_ids: [], agent_ids: ["agent-1"], use_all_forms: false, order_index: 0 }],
        form_mappings: [{ page_id: "page-1", form_id: "form-1", form_name: "Formulário", agent_id: "agent-1" }],
      },
      external_apis: {
        purchased: 0,
        used: 1,
        connectors: [{ id: "connector-1", name: "Catálogo", description: "", base_url: "https://api.example.test", auth_type: "bearer", auth_header_name: null, auth_username: null, credential_configured: true, enabled: true, is_primary: true, health_status: "healthy", last_health_at: "2026-08-11T09:00:00Z", last_error_code: null, operation_count: 3, agent_count: 1, created_at: "2026-08-11T09:00:00Z", updated_at: "2026-08-11T09:00:00Z" }],
      },
    },
  });
});

describe("IntegrationsDashboardSnapshotV1", () => {
  it("normaliza uma única RPC sem expor credenciais", async () => {
    const snapshot = await loadIntegrationsDashboardSnapshot(session);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_integrations_dashboard_snapshot_v1", { p_tenant_id: "tenant-a" });
    expect(snapshot.version).toBe(1);
    expect(snapshot.whatsapp.connections).toHaveLength(2);
    expect(snapshot.whatsapp.connections.every((item) => item.activeProvider === "cloud_api")).toBe(true);
    expect(snapshot.meta.connected).toBe(true);
    expect(snapshot.meta.pages[0]?.forms[0]).toMatchObject({ form_id: "form-1", has_active_rule: true });
    expect(snapshot.externalApis.connectors[0]).toMatchObject({ operationCount: 3, effective: true });
    expect(JSON.stringify(snapshot)).not.toMatch(/access_token|credential_ciphertext|stripe_price_id/i);
  });

  it("mantém conectores excedentes suspensos sem apagar a configuração", async () => {
    const raw = structuredClone((await rpc()).data);
    raw.external_apis.connectors.push({ ...raw.external_apis.connectors[0], id: "connector-2", is_primary: false });
    raw.external_apis.used = 2;
    rpc.mockResolvedValueOnce({ data: raw, error: null });

    const snapshot = await loadIntegrationsDashboardSnapshot(session);
    expect(snapshot.externalApis.connectors[1]).toMatchObject({ effective: false, billingStatus: "suspended" });
  });
});

describe("migração do snapshot", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260811091347_integrations_dashboard_snapshot_v1.sql"),
    "utf8",
  );

  it("é service-role only e não seleciona segredos para o JSON", () => {
    expect(sql).toContain("grant execute on function public.get_integrations_dashboard_snapshot_v1(text) to service_role");
    expect(sql).toContain("revoke all on function public.get_integrations_dashboard_snapshot_v1(text) from authenticated");
    expect(sql).not.toMatch(/'page_access_token'|'access_token'|'credential_ciphertext'|'stripe_price_id'/);
  });
});
