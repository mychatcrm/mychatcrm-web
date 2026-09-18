import { beforeEach, describe, expect, it, vi } from "vitest";

const { visibleLeadIdsMock } = vi.hoisted(() => ({ visibleLeadIdsMock: vi.fn() }));

vi.mock("@/lib/server/access-scope", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/access-scope")>(
    "@/lib/server/access-scope",
  );
  return { ...actual, visibleLeadIds: visibleLeadIdsMock };
});

import {
  countMetaLeadEvents,
  loadCentralFacets,
  resetArchiveSupportCache,
  sanitizeSearchTerm,
  searchMetaLeadEvents,
  stepConditionForBuckets,
} from "@/lib/server/meta-lead-central";
import { EMPTY_CENTRAL_FILTERS, type MetaLeadCentralFilters } from "@/lib/meta-leads/central-filters";
import type { AccessScope } from "@/lib/server/access-scope";

type Captured = {
  table: string;
  columns: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  or: string[];
  gte: Record<string, unknown>;
  lte: Record<string, unknown>;
  lt: Record<string, unknown>;
  not: Array<[string, string, unknown]>;
  is: Record<string, unknown>;
  limit: number | null;
  head: boolean;
};

/**
 * Builder falso do PostgREST: regista o que foi pedido e devolve as linhas
 * combinadas. O que importa testar é qual recorte chegou ao banco — foi
 * exatamente aí que o painel antigo falhava, filtrando só depois de responder.
 */
function makeSupabase(pages: Record<string, unknown[]>, options: { archived?: boolean; count?: number } = {}) {
  const captured: Captured[] = [];
  const archived = options.archived !== false;

  const client = {
    from(table: string) {
      const state: Captured = {
        table, columns: "", eq: {}, in: {}, or: [], gte: {}, lte: {}, lt: {},
        not: [], is: {}, limit: null, head: false,
      };
      captured.push(state);

      const rowsFor = (): unknown[] => {
        if (table === "meta_lead_events" && state.columns === "archived_at") {
          return archived ? [{ archived_at: null }] : [];
        }
        return pages[table] ?? [];
      };

      const builder: Record<string, unknown> = {
        select(columns: string, opts?: { count?: string; head?: boolean }) {
          state.columns = columns;
          state.head = Boolean(opts?.head);
          if (table === "meta_lead_events" && columns === "archived_at" && !archived) {
            return { ...builder, limit: () => Promise.resolve({ data: null, error: { code: "42703" } }) };
          }
          return builder;
        },
        eq(column: string, value: unknown) { state.eq[column] = value; return builder; },
        in(column: string, values: unknown[]) { state.in[column] = values; return builder; },
        or(filter: string) { state.or.push(filter); return builder; },
        gte(column: string, value: unknown) { state.gte[column] = value; return builder; },
        lte(column: string, value: unknown) { state.lte[column] = value; return builder; },
        lt(column: string, value: unknown) { state.lt[column] = value; return builder; },
        gt(column: string, value: unknown) { state.lt[column] = value; return builder; },
        not(column: string, operator: string, value: unknown) {
          state.not.push([column, operator, value]);
          return builder;
        },
        is(column: string, value: unknown) { state.is[column] = value; return builder; },
        order() { return builder; },
        maybeSingle: () => Promise.resolve({ data: rowsFor()[0] ?? null, error: null }),
        limit(count: number) {
          state.limit = count;
          const data = rowsFor().slice(0, count);
          return Promise.resolve({ data, error: null, count: options.count ?? data.length });
        },
        then(resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) {
          const data = rowsFor();
          return Promise.resolve(resolve({ data, error: null, count: options.count ?? data.length }));
        },
      };
      return builder;
    },
  };

  return { client: client as never, captured };
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    leadgen_id: `lg-${id}`,
    page_id: "page-1",
    page_name: "Página",
    form_id: "form-1",
    form_name: "Formulário",
    campaign_id: "camp-1",
    campaign_name: "Campanha A",
    adset_id: "adset-1",
    adset_name: "Conjunto",
    ad_id: "ad-1",
    ad_name: "Anúncio",
    lead_id: `lead-${id}`,
    name: "Fulano",
    phone: "5511999999999",
    email: "a@b.com",
    agent_id: "agent-1",
    agent_resolution_source: "rule",
    crm_sync_status: "synced",
    whatsapp_status: "sent",
    current_step: "whatsapp_sent",
    error_message: null,
    created_at: "2026-09-17T12:00:00.000Z",
    updated_at: "2026-09-17T12:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

const OWNER: AccessScope = { kind: "all" };

function filters(overrides: Partial<MetaLeadCentralFilters> = {}): MetaLeadCentralFilters {
  return { ...EMPTY_CENTRAL_FILTERS, ...overrides };
}

beforeEach(() => {
  resetArchiveSupportCache();
  visibleLeadIdsMock.mockReset();
});

describe("stepConditionForBuckets", () => {
  it("sem balde escolhido não filtra", () => {
    expect(stepConditionForBuckets([])).toEqual({ mode: "all" });
  });

  it("os quatro baldes equivalem a não filtrar", () => {
    expect(stepConditionForBuckets(["novo", "ok", "erro", "sem_regra"])).toEqual({ mode: "all" });
  });

  it("baldes concretos viram lista de passos", () => {
    const condition = stepConditionForBuckets(["ok"]);
    expect(condition.mode).toBe("include");
    if (condition.mode === "include") expect(condition.steps).toContain("whatsapp_sent");
  });

  it('"novo" vira exclusão — é tudo o que não caiu nos outros', () => {
    const condition = stepConditionForBuckets(["novo"]);
    expect(condition.mode).toBe("exclude");
    if (condition.mode === "exclude") {
      expect(condition.steps).toContain("whatsapp_sent");
      expect(condition.steps).toContain("crm_lead_failed");
      expect(condition.steps).toContain("blocked_form_not_registered_in_lead_rules");
    }
  });

  it('"novo" + "erro" exclui só os baldes que ficaram de fora', () => {
    const condition = stepConditionForBuckets(["novo", "erro"]);
    expect(condition.mode).toBe("exclude");
    if (condition.mode === "exclude") {
      expect(condition.steps).toContain("whatsapp_sent");
      expect(condition.steps).not.toContain("crm_lead_failed");
    }
  });
});

describe("sanitizeSearchTerm", () => {
  it("remove a sintaxe do PostgREST para o termo não virar filtro", () => {
    expect(sanitizeSearchTerm('ana,(or)"x"*')).toBe("ana or x");
  });

  it("mantém um termo normal intacto", () => {
    expect(sanitizeSearchTerm("  João Silva ")).toBe("João Silva");
  });
});

describe("searchMetaLeadEvents", () => {
  it("aplica período, campanha e busca na query, não em memória", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] });
    await searchMetaLeadEvents({
      sb: client,
      tenantId: "tenant-1",
      scope: OWNER,
      filters: filters({
        from: "2026-09-01",
        to: "2026-09-17",
        campaignIds: ["camp-1"],
        search: "ana",
      }),
      limit: 10,
    });

    const query = captured.find((entry) => entry.columns.includes("leadgen_id"));
    expect(query?.eq.tenant_id).toBe("tenant-1");
    expect(query?.gte.created_at).toBe("2026-09-01T03:00:00.000Z");
    expect(query?.lt.created_at).toBe("2026-09-18T03:00:00.000Z");
    expect(query?.in.campaign_id).toEqual(["camp-1"]);
    expect(query?.or.some((clause) => clause.includes("ana"))).toBe(true);
  });

  it("nunca carrega os campos pesados na lista", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] });
    await searchMetaLeadEvents({ sb: client, tenantId: "t", scope: OWNER, filters: filters(), limit: 5 });

    const query = captured.find((entry) => entry.columns.includes("leadgen_id"));
    expect(query?.columns).not.toContain("profile_metadata");
    expect(query?.columns).not.toContain("raw_webhook");
    expect(query?.columns).not.toContain("steps_log");
    expect(query?.columns).not.toContain("form_fields");
  });

  it("esconde os arquivados por padrão", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] });
    await searchMetaLeadEvents({ sb: client, tenantId: "t", scope: OWNER, filters: filters(), limit: 5 });

    const query = captured.find((entry) => entry.columns.includes("leadgen_id"));
    expect(query?.is.archived_at).toBeNull();
  });

  it("devolve cursor quando há mais do que a página pedida", async () => {
    const rows = [row("1"), row("2", { created_at: "2026-09-17T11:00:00.000Z" })];
    const { client } = makeSupabase({ meta_lead_events: rows });
    const result = await searchMetaLeadEvents({
      sb: client, tenantId: "t", scope: OWNER, filters: filters(), limit: 1,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.nextCursor).toEqual({ createdAt: "2026-09-17T12:00:00.000Z", id: "1" });
  });

  it("não devolve cursor quando a página é a última", async () => {
    const { client } = makeSupabase({ meta_lead_events: [row("1")] });
    const result = await searchMetaLeadEvents({
      sb: client, tenantId: "t", scope: OWNER, filters: filters(), limit: 10,
    });
    expect(result.nextCursor).toBeNull();
  });

  /**
   * O corte por instante é inclusivo e o desempate por id fica em memória: dois
   * `or=` na mesma URL (busca livre + cursor) não têm combinação garantida no
   * PostgREST, e a paginação não pode depender disso.
   */
  it("corta por instante e resolve o empate de id em memória", async () => {
    const sameInstant = [
      row("9", { created_at: "2026-09-17T12:00:00.000Z" }),
      row("5", { created_at: "2026-09-17T12:00:00.000Z" }),
    ];
    const { client, captured } = makeSupabase({ meta_lead_events: sameInstant });

    const result = await searchMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: OWNER,
      filters: filters(),
      cursor: { createdAt: "2026-09-17T12:00:00.000Z", id: "9" },
      limit: 10,
    });

    const query = captured.find((entry) => entry.columns.includes("leadgen_id"));
    expect(query?.lte.created_at).toBe("2026-09-17T12:00:00.000Z");
    expect(query?.or).toHaveLength(0);
    // "9" já tinha sido devolvido na página anterior; só "5" continua.
    expect(result.rows.map((entry) => entry.id)).toEqual(["5"]);
  });

  it("recorte estreito devolve cursor de varredura em vez de fingir que acabou", async () => {
    // Nenhum dos leads varridos pertence ao vendedor, e o lote veio cheio:
    // devolver `nextCursor: null` aqui escondia a base inteira dele.
    const many = Array.from({ length: 200 }, (_, index) =>
      row(`x${index}`, {
        lead_id: "lead-de-outro",
        created_at: new Date(Date.UTC(2026, 8, 17, 12, 0, 0) - index * 1000).toISOString(),
      }),
    );
    visibleLeadIdsMock.mockResolvedValue(new Set(Array.from({ length: 400 }, (_, i) => `lead-meu-${i}`)));
    const { client } = makeSupabase({ meta_lead_events: many });

    const result = await searchMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: { kind: "teams", teamIds: ["team-1"] },
      filters: filters(),
      limit: 10,
    });

    expect(result.rows).toHaveLength(0);
    expect(result.nextCursor).not.toBeNull();
  });

  it("vendedor com poucos leads recorta pela query", async () => {
    visibleLeadIdsMock.mockResolvedValue(new Set(["lead-1"]));
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] });

    await searchMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: { kind: "own", employeeId: "emp-1" },
      filters: filters(),
      limit: 10,
    });

    const query = captured.find((entry) => entry.columns.includes("leadgen_id"));
    expect(query?.in.lead_id).toEqual(["lead-1"]);
  });

  it("descarta lead de outra equipe quando o recorte é grande", async () => {
    const allowed = new Set(Array.from({ length: 400 }, (_, index) => `lead-other-${index}`));
    allowed.add("lead-2");
    visibleLeadIdsMock.mockResolvedValue(allowed);

    const { client } = makeSupabase({ meta_lead_events: [row("1"), row("2")] });
    const result = await searchMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: { kind: "teams", teamIds: ["team-1"] },
      filters: filters(),
      limit: 10,
    });

    expect(result.rows.map((entry) => entry.id)).toEqual(["2"]);
  });

  it("evento sem lead no CRM não aparece para quem não é o titular", async () => {
    visibleLeadIdsMock.mockResolvedValue(new Set(["lead-1"]));
    const { client } = makeSupabase({ meta_lead_events: [row("1", { lead_id: null })] });

    const result = await searchMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: { kind: "own", employeeId: "emp-1" },
      filters: filters(),
      limit: 10,
    });

    expect(result.rows).toHaveLength(0);
  });

  it("escopo vazio não vai ao banco", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] });
    const result = await searchMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: { kind: "teams", teamIds: [] },
      filters: filters(),
      limit: 10,
    });

    expect(result.rows).toHaveLength(0);
    expect(captured.some((entry) => entry.columns.includes("leadgen_id"))).toBe(false);
  });

  it("sem a migração aplicada, a lista funciona e ignora o arquivamento", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] }, { archived: false });
    const result = await searchMetaLeadEvents({
      sb: client, tenantId: "t", scope: OWNER, filters: filters(), limit: 10,
    });

    expect(result.rows).toHaveLength(1);
    const query = captured.find((entry) => entry.columns.includes("leadgen_id"));
    expect(query?.columns).not.toContain("archived_at");
    expect(query?.is.archived_at).toBeUndefined();
  });
});

describe("loadCentralFacets", () => {
  it("agrupa e conta as opções do período", async () => {
    const { client } = makeSupabase({
      meta_lead_events: [
        { page_id: "p1", page_name: "Página 1", form_id: "f1", form_name: "Form 1", campaign_id: "c1", campaign_name: "Camp 1", adset_id: "s1", adset_name: "Set 1", ad_id: "a1", ad_name: "Ad 1", agent_id: "ag1", lead_id: "lead-1" },
        { page_id: "p1", page_name: "Página 1", form_id: "f2", form_name: "Form 2", campaign_id: "c1", campaign_name: "Camp 1", adset_id: "s1", adset_name: "Set 1", ad_id: "a2", ad_name: "Ad 2", agent_id: "ag1", lead_id: "lead-2" },
      ],
    });

    const facets = await loadCentralFacets({ sb: client, tenantId: "t", scope: OWNER, filters: filters() });

    expect(facets.campaigns).toEqual([{ value: "c1", label: "Camp 1", count: 2 }]);
    expect(facets.forms.map((option) => option.value).sort()).toEqual(["f1", "f2"]);
    expect(facets.sampled).toBe(2);
  });

  it("ignora os próprios recortes de atribuição para não esvaziar a lista", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [] });
    await loadCentralFacets({
      sb: client,
      tenantId: "t",
      scope: OWNER,
      filters: filters({ campaignIds: ["c1"], from: "2026-09-01" }),
    });

    const query = captured.find((entry) => entry.columns.includes("campaign_name"));
    expect(query?.in.campaign_id).toBeUndefined();
    expect(query?.gte.created_at).toBe("2026-09-01T03:00:00.000Z");
  });
});

describe("countMetaLeadEvents", () => {
  it("não conta quando o recorte por equipe é grande demais para varrer", async () => {
    visibleLeadIdsMock.mockResolvedValue(new Set(Array.from({ length: 400 }, (_, i) => `lead-${i}`)));
    const { client } = makeSupabase({ meta_lead_events: [row("1")] });

    const result = await countMetaLeadEvents({
      sb: client,
      tenantId: "t",
      scope: { kind: "teams", teamIds: ["team-1"] },
      filters: filters(),
    });

    expect(result).toEqual({ total: null, exact: false });
  });

  it("conta pelo banco para o titular", async () => {
    const { client } = makeSupabase({ meta_lead_events: [row("1")] }, { count: 1234 });
    const result = await countMetaLeadEvents({ sb: client, tenantId: "t", scope: OWNER, filters: filters() });
    expect(result).toEqual({ total: 1234, exact: true });
  });

  it("escopo vazio conta zero sem consultar", async () => {
    const { client, captured } = makeSupabase({ meta_lead_events: [row("1")] });
    const result = await countMetaLeadEvents({
      sb: client, tenantId: "t", scope: { kind: "teams", teamIds: [] }, filters: filters(),
    });
    expect(result).toEqual({ total: 0, exact: true });
    expect(captured).toHaveLength(0);
  });
});
