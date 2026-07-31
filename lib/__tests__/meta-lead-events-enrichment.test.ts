import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichMissingMetaLeadEventNames } from "@/lib/server/meta-lead-events-enrichment";
import type { MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";

function baseEvent(overrides: Partial<MetaLeadEventRow> = {}): MetaLeadEventRow {
  return {
    id: "evt-1",
    tenant_id: "tenant-a",
    leadgen_id: "lg-1",
    page_id: "page-1",
    form_id: "form-1",
    ad_id: null,
    adset_id: null,
    lead_id: null,
    name: "Lead X",
    phone: "5511999999999",
    email: null,
    form_name: null,
    page_name: "Página X",
    campaign_id: null,
    campaign_name: null,
    adset_name: null,
    ad_name: null,
    agent_id: null,
    agent_resolution_source: null,
    crm_sync_status: "blocked",
    whatsapp_status: "blocked",
    current_step: "blocked_form_not_registered_in_lead_rules",
    steps_log: [],
    form_fields: [],
    profile_metadata: null,
    raw_webhook: null,
    error_message: "form_not_registered_in_lead_rules",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeSupabase(options: {
  connections?: Array<{ page_id: string; page_access_token: string | null; user_access_token: string | null }>;
  connectionsError?: { message: string };
  updateSpy?: ReturnType<typeof vi.fn>;
}) {
  const updateSpy = options.updateSpy ?? vi.fn(async () => ({ error: null }));
  return {
    from(table: string) {
      if (table === "meta_connections") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: options.connections ?? [],
                error: options.connectionsError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === "meta_lead_events") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => updateSpy(patch, id),
          }),
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };
}

describe("enrichMissingMetaLeadEventNames", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolve o nome do formulário quando faltando e persiste no banco", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/form-1") && url.includes("fields=name")) {
        return new Response(JSON.stringify({ name: "Formulário Recrutamento" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const updateSpy = vi.fn(async () => ({ error: null }));
    const sb = fakeSupabase({
      connections: [{ page_id: "page-1", page_access_token: "page-token", user_access_token: null }],
      updateSpy,
    });

    const events = [baseEvent()];
    await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    expect(events[0]!.form_name).toBe("Formulário Recrutamento");
    expect(updateSpy).toHaveBeenCalledWith({ form_name: "Formulário Recrutamento" }, "evt-1");
  });

  it("resolve campanha/conjunto/anúncio quando há ad_id, usando o token de usuário", async () => {
    const sentTokens: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      // O token viaja no cabeçalho Authorization, não na URL.
      sentTokens.push(String(new Headers(init?.headers).get("authorization") ?? url));
      if (url.includes("/ad-1")) {
        return new Response(
          JSON.stringify({
            name: "Anúncio X",
            campaign: { id: "camp-1", name: "Campanha X" },
            adset: { id: "adset-1", name: "Conjunto X" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const sb = fakeSupabase({
      connections: [
        { page_id: "page-1", page_access_token: "page-token", user_access_token: "user-token" },
      ],
    });

    const events = [baseEvent({ form_name: "Já tem nome", ad_id: "ad-1" })];
    await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    expect(events[0]!.campaign_name).toBe("Campanha X");
    expect(events[0]!.adset_name).toBe("Conjunto X");
    expect(events[0]!.ad_name).toBe("Anúncio X");
    expect(sentTokens.some((t) => t.includes("user-token"))).toBe(true);
  });

  it("não chama a Graph API nem escreve quando o evento já tem tudo preenchido", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const sb = fakeSupabase({
      connections: [{ page_id: "page-1", page_access_token: "page-token", user_access_token: null }],
    });

    const events = [
      baseEvent({ form_name: "Form", campaign_name: "Camp", adset_name: "Adset", ad_name: "Ad", ad_id: "ad-1" }),
    ];
    await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pula sem quebrar quando não há conexão/token pra aquela página", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const sb = fakeSupabase({ connections: [] });

    const events = [baseEvent()];
    const result = await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    expect(result[0]!.form_name).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha de Graph API não derruba a chamada nem os outros eventos", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/form-1")) throw new Error("network down");
      if (url.includes("/form-2")) return new Response(JSON.stringify({ name: "Form 2" }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const sb = fakeSupabase({
      connections: [{ page_id: "page-1", page_access_token: "page-token", user_access_token: null }],
    });

    const events = [
      baseEvent({ id: "evt-1", form_id: "form-1" }),
      baseEvent({ id: "evt-2", form_id: "form-2" }),
    ];
    await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    expect(events[0]!.form_name).toBeNull();
    expect(events[1]!.form_name).toBe("Form 2");
  });

  it("falha ao persistir não impede o valor de aparecer na resposta em memória", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ name: "Form OK" }), { status: 200 }));

    const updateSpy = vi.fn(async () => ({ error: { message: "db down" } }));
    const sb = fakeSupabase({
      connections: [{ page_id: "page-1", page_access_token: "page-token", user_access_token: null }],
      updateSpy,
    });

    const events = [baseEvent()];
    await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    expect(events[0]!.form_name).toBe("Form OK");
    expect(updateSpy).toHaveBeenCalled();
  });

  it("respeita o teto por requisição sem travar numa lista grande", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ name: "Nome" }), { status: 200 }));

    const sb = fakeSupabase({
      connections: [{ page_id: "page-1", page_access_token: "page-token", user_access_token: null }],
    });

    const events = Array.from({ length: 30 }, (_, i) => baseEvent({ id: `evt-${i}`, form_id: `form-${i}` }));
    await enrichMissingMetaLeadEventNames(sb as never, "tenant-a", events);

    const enrichedCount = events.filter((ev) => ev.form_name === "Nome").length;
    expect(enrichedCount).toBeGreaterThan(0);
    expect(enrichedCount).toBeLessThan(30);
  });
});
