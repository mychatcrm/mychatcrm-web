import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AccessScope } from "@/lib/server/access-scope";
import { scopeMatchesNothing, visibleLeadIds } from "@/lib/server/access-scope";
import {
  META_LEAD_EVENT_ERROR_STEPS,
  META_LEAD_EVENT_NO_RULE_STEPS,
  META_LEAD_EVENT_OK_STEPS,
  type MetaLeadEventBucket,
} from "@/lib/meta-lead-event-status";
import {
  zonedDayEndExclusiveISO,
  zonedDayStartISO,
  type MetaLeadCentralFilters,
} from "@/lib/meta-leads/central-filters";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Colunas da Central. Deliberadamente **sem** `steps_log`, `form_fields`,
 * `profile_metadata` e `raw_webhook`: o painel antigo devolvia os quatro para
 * até 1000 leads a cada 15 segundos, e `profile_metadata` carrega o webhook
 * cru inteiro. O detalhe pesado só é lido ao abrir um lead.
 */
export const CENTRAL_LIST_COLUMNS = [
  "id",
  "leadgen_id",
  "page_id",
  "page_name",
  "form_id",
  "form_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "lead_id",
  "name",
  "phone",
  "email",
  "agent_id",
  "agent_resolution_source",
  "crm_sync_status",
  "whatsapp_status",
  "current_step",
  "error_message",
  "created_at",
  "updated_at",
].join(", ");

export type CentralLeadRow = {
  id: string;
  leadgen_id: string;
  page_id: string;
  page_name: string | null;
  form_id: string | null;
  form_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  lead_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  agent_id: string | null;
  agent_resolution_source: string | null;
  crm_sync_status: string;
  whatsapp_status: string;
  current_step: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
};

export type CentralCursor = { createdAt: string; id: string };

export type CentralSearchResult = {
  rows: CentralLeadRow[];
  nextCursor: CentralCursor | null;
  /** `true` quando o recorte por equipe/dono removeu linhas desta página. */
  scopeApplied: boolean;
};

export const CENTRAL_PAGE_SIZES = [25, 50, 100, 200] as const;
export const CENTRAL_DEFAULT_PAGE_SIZE = 50;
export const CENTRAL_MAX_PAGE_SIZE = 200;
/** Acima disto o `in(...)` vira uma URL grande demais — filtra-se em memória. */
const SCOPE_INLINE_LIMIT = 300;
const SCOPE_SCAN_ROUNDS = 6;

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204", "PGRST205", "42P01"]);

export function isMissingSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && MISSING_COLUMN_CODES.has(error.code)) return true;
  return (error.message ?? "").toLowerCase().includes("archived_at");
}

let archivedColumnAvailable: boolean | null = null;
let archivedColumnCheckedAt = 0;
/** Só o "não existe" expira: depois da migração o recurso aparece sozinho. */
const ARCHIVE_NEGATIVE_CACHE_MS = 5 * 60 * 1000;

/**
 * A coluna `archived_at` chega na migração da Central. Enquanto ela não for
 * aplicada o painel continua a funcionar em modo leitura — arquivar é que fica
 * indisponível, com aviso explícito, em vez de a página inteira falhar.
 */
export async function hasArchiveSupport(sb: SupabaseServiceClient): Promise<boolean> {
  if (archivedColumnAvailable === true) return true;
  if (archivedColumnAvailable === false && Date.now() - archivedColumnCheckedAt < ARCHIVE_NEGATIVE_CACHE_MS) {
    return false;
  }
  const { error } = await sb.from("meta_lead_events").select("archived_at").limit(1);
  archivedColumnAvailable = !isMissingSchemaError(error);
  archivedColumnCheckedAt = Date.now();
  return archivedColumnAvailable;
}

/** Só para os testes — o cache é por processo. */
export function resetArchiveSupportCache(): void {
  archivedColumnAvailable = null;
  archivedColumnCheckedAt = 0;
}

/**
 * Baldes → condição sobre `current_step`.
 *
 * "novo" não tem lista própria: é tudo o que não caiu nos outros três. Por isso
 * quando "novo" está selecionado o filtro vira uma exclusão dos baldes que
 * ficaram de fora — exato, e sem ter de enumerar passos que ainda nem existem.
 */
export function stepConditionForBuckets(
  buckets: MetaLeadEventBucket[],
): { mode: "all" } | { mode: "include"; steps: string[] } | { mode: "exclude"; steps: string[] } {
  const selected = new Set(buckets);
  if (selected.size === 0 || selected.size === 4) return { mode: "all" };

  const stepsOf = (bucket: MetaLeadEventBucket): string[] => {
    if (bucket === "erro") return Array.from(META_LEAD_EVENT_ERROR_STEPS);
    if (bucket === "ok") return Array.from(META_LEAD_EVENT_OK_STEPS);
    if (bucket === "sem_regra") return Array.from(META_LEAD_EVENT_NO_RULE_STEPS);
    return [];
  };

  if (selected.has("novo")) {
    const excluded: string[] = [];
    for (const bucket of ["erro", "ok", "sem_regra"] as const) {
      if (!selected.has(bucket)) excluded.push(...stepsOf(bucket));
    }
    return excluded.length > 0 ? { mode: "exclude", steps: excluded } : { mode: "all" };
  }

  const included: string[] = [];
  for (const bucket of selected) included.push(...stepsOf(bucket));
  return included.length > 0 ? { mode: "include", steps: included } : { mode: "all" };
}

/** PostgREST trata `,` `.` `(` `)` e `"` como sintaxe — o termo de busca não pode carregá-los. */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()"*\\%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Forma estrutural mínima do builder do PostgREST. Os genéricos reais do
 * supabase-js mudam a cada `select()` e não sobrevivem a um helper partilhado
 * (o compilador estoura em "type instantiation is excessively deep"); esta
 * interface recursiva preserva o encadeamento sem herdar essa profundidade.
 */
type FilterableQuery<Self> = {
  gte(column: string, value: unknown): Self;
  lte(column: string, value: unknown): Self;
  lt(column: string, value: unknown): Self;
  gt(column: string, value: unknown): Self;
  in(column: string, values: readonly unknown[]): Self;
  is(column: string, value: null): Self;
  not(column: string, operator: string, value: unknown): Self;
  or(filters: string): Self;
};

type OrderableQuery<Self> = {
  order(column: string, options: { ascending: boolean }): Self;
  limit(count: number): Self;
};

function applyCentralFilters<Q extends FilterableQuery<Q>>(
  query: Q,
  filters: MetaLeadCentralFilters,
  options: { archiveSupported: boolean },
): Q {
  let next = query;

  const fromISO = filters.from ? zonedDayStartISO(filters.from, filters.timezone) : null;
  const toISO = filters.to ? zonedDayEndExclusiveISO(filters.to, filters.timezone) : null;
  if (fromISO) next = next.gte("created_at", fromISO);
  if (toISO) next = next.lt("created_at", toISO);

  if (filters.pageIds.length) next = next.in("page_id", filters.pageIds);
  if (filters.formIds.length) next = next.in("form_id", filters.formIds);
  if (filters.campaignIds.length) next = next.in("campaign_id", filters.campaignIds);
  if (filters.adsetIds.length) next = next.in("adset_id", filters.adsetIds);
  if (filters.adIds.length) next = next.in("ad_id", filters.adIds);
  if (filters.agentIds.length) next = next.in("agent_id", filters.agentIds);
  if (filters.crmStatuses.length) next = next.in("crm_sync_status", filters.crmStatuses);
  if (filters.waStatuses.length) next = next.in("whatsapp_status", filters.waStatuses);

  const stepCondition = stepConditionForBuckets(filters.buckets);
  if (stepCondition.mode === "include") next = next.in("current_step", stepCondition.steps);
  if (stepCondition.mode === "exclude") {
    next = next.not("current_step", "in", `(${stepCondition.steps.join(",")})`);
  }

  const term = sanitizeSearchTerm(filters.search);
  if (term) {
    next = next.or(`name.ilike.*${term}*,phone.ilike.*${term}*,email.ilike.*${term}*`);
  }

  if (options.archiveSupported) {
    if (filters.archived === "active") next = next.is("archived_at", null);
    if (filters.archived === "archived") next = next.not("archived_at", "is", null);
  }

  return next;
}

/**
 * Corte do keyset por `created_at` apenas, inclusivo no instante do cursor.
 *
 * O desempate por id acontece em memória (`isAfterCursor`), e não com um
 * segundo `or=` na query: a busca livre já usa um `or`, e o PostgREST não
 * garante como combina dois parâmetros `or` na mesma URL. Empate de instante é
 * real — uma rajada do mesmo formulário chega com o mesmo timestamp — então
 * incluir o instante e filtrar depois é o que mantém a paginação exata.
 */
function applyCursor<Q extends FilterableQuery<Q>>(
  query: Q,
  cursor: CentralCursor | null,
  sort: MetaLeadCentralFilters["sort"],
): Q {
  if (!cursor) return query;
  return sort === "oldest"
    ? query.gte("created_at", cursor.createdAt)
    : query.lte("created_at", cursor.createdAt);
}

/** `true` quando a linha vem depois do cursor na ordem pedida. */
export function isAfterCursor(
  row: { created_at: string; id: string },
  cursor: CentralCursor | null,
  sort: MetaLeadCentralFilters["sort"],
): boolean {
  if (!cursor) return true;
  if (row.created_at !== cursor.createdAt) {
    return sort === "oldest" ? row.created_at > cursor.createdAt : row.created_at < cursor.createdAt;
  }
  return sort === "oldest" ? row.id > cursor.id : row.id < cursor.id;
}

function applyOrder<Q extends OrderableQuery<Q>>(query: Q, sort: MetaLeadCentralFilters["sort"]): Q {
  const ascending = sort === "oldest";
  return query.order("created_at", { ascending }).order("id", { ascending });
}

/** Interseção de dois conjuntos de leads; `null` de um lado significa "sem restrição". */
export function intersectLeadIds(
  a: Set<string> | null,
  b: Set<string> | null,
): Set<string> | null {
  if (a === null) return b;
  if (b === null) return a;
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  const result = new Set<string>();
  for (const id of smaller) if (larger.has(id)) result.add(id);
  return result;
}

/**
 * Página da Central com o recorte de acesso aplicado **na query**.
 *
 * Evento sem `lead_id` (bloqueado antes de chegar ao CRM) só é visível para o
 * titular — mesma regra do lead legado sem equipe em `access-scope`.
 */
export async function searchMetaLeadEvents(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  scope: AccessScope;
  filters: MetaLeadCentralFilters;
  cursor?: CentralCursor | null;
  limit?: number;
  /**
   * Restrição adicional por lead do CRM — hoje o filtro por desfecho, que vive
   * em `leads` e não em `meta_lead_events`. Combina-se com o recorte de acesso
   * por interseção: um filtro nunca amplia o que a pessoa pode ver.
   */
  leadIdFilter?: Set<string> | null;
}): Promise<CentralSearchResult> {
  const { sb, tenantId, scope, filters } = params;
  const limit = Math.min(CENTRAL_MAX_PAGE_SIZE, Math.max(1, params.limit ?? CENTRAL_DEFAULT_PAGE_SIZE));
  const archiveSupported = await hasArchiveSupport(sb);
  const columns = archiveSupported ? `${CENTRAL_LIST_COLUMNS}, archived_at` : CENTRAL_LIST_COLUMNS;

  if (scopeMatchesNothing(scope)) {
    return { rows: [], nextCursor: null, scopeApplied: true };
  }

  let allowedLeadIds: Set<string> | null = null;
  if (scope.kind !== "all") {
    allowedLeadIds = await visibleLeadIds(sb, tenantId, scope);
    if (allowedLeadIds && allowedLeadIds.size === 0) {
      return { rows: [], nextCursor: null, scopeApplied: true };
    }
  }
  allowedLeadIds = intersectLeadIds(allowedLeadIds, params.leadIdFilter ?? null);
  if (allowedLeadIds && allowedLeadIds.size === 0) {
    return { rows: [], nextCursor: null, scopeApplied: scope.kind !== "all" };
  }

  const inlineScope =
    allowedLeadIds !== null && allowedLeadIds.size > 0 && allowedLeadIds.size <= SCOPE_INLINE_LIMIT;

  const collected: CentralLeadRow[] = [];
  const startCursor = params.cursor ?? null;
  // Duas posições distintas: até onde a varredura chegou e qual foi a última
  // linha aceite. Confundi-las escondia leads — com um recorte estreito, várias
  // rondas podiam não devolver nada e a página terminava sem cursor, como se
  // fosse o fim da base.
  let scanCursor = startCursor;
  let exhausted = false;

  for (let round = 0; round < SCOPE_SCAN_ROUNDS && collected.length <= limit && !exhausted; round += 1) {
    // Com recorte em memória o lote é maior: parte das linhas vai cair fora.
    const batchSize = allowedLeadIds === null || inlineScope ? limit + 1 : (limit + 1) * 3;

    let query = sb.from("meta_lead_events").select(columns).eq("tenant_id", tenantId);
    query = applyCentralFilters(query, filters, { archiveSupported });
    if (inlineScope && allowedLeadIds) {
      query = query.in("lead_id", Array.from(allowedLeadIds));
    }
    query = applyCursor(query, scanCursor, filters.sort);
    query = applyOrder(query, filters.sort).limit(batchSize);

    const { data, error } = await query;
    if (error) throw new Error(`meta_lead_central_query_failed: ${error.message}`);

    const batch = (data ?? []) as unknown as CentralLeadRow[];
    if (batch.length < batchSize) exhausted = true;
    if (batch.length === 0) break;

    let advanced = false;
    for (const row of batch) {
      // O corte por instante é inclusivo: as linhas do mesmo timestamp que já
      // foram devolvidas voltam a aparecer e são descartadas aqui.
      if (!isAfterCursor(row, scanCursor, filters.sort)) continue;
      advanced = true;

      if (allowedLeadIds !== null && (!row.lead_id || !allowedLeadIds.has(row.lead_id))) continue;
      collected.push(row);
      if (collected.length > limit) break;
    }

    const last = batch[batch.length - 1];
    if (last) scanCursor = { createdAt: last.created_at, id: last.id };
    // Lote inteiro no mesmo instante do cursor: sem isto a varredura ficaria
    // presa a pedir sempre as mesmas linhas.
    if (!advanced && !exhausted) break;
  }

  const hasMore = collected.length > limit;
  const rows = hasMore ? collected.slice(0, limit) : collected;
  const lastRow = rows[rows.length - 1];

  const nextCursor = hasMore && lastRow
    ? { createdAt: lastRow.created_at, id: lastRow.id }
    : // Parou por limite de rondas, não por fim da base: continua de onde varreu.
      !exhausted && scanCursor
      ? scanCursor
      : null;

  return { rows, nextCursor, scopeApplied: scope.kind !== "all" };
}

/**
 * Percorre a Central inteira em páginas — usado pelo export, que não pode
 * carregar tudo em memória nem devolver só os primeiros mil.
 */
export async function* iterateMetaLeadEvents(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  scope: AccessScope;
  filters: MetaLeadCentralFilters;
  pageSize?: number;
  maxRows?: number;
  leadIdFilter?: Set<string> | null;
}): AsyncGenerator<CentralLeadRow[], void, void> {
  const pageSize = Math.min(CENTRAL_MAX_PAGE_SIZE, Math.max(50, params.pageSize ?? CENTRAL_MAX_PAGE_SIZE));
  const maxRows = Math.max(1, params.maxRows ?? 100_000);
  let cursor: CentralCursor | null = null;
  let emitted = 0;
  let emptyRounds = 0;

  while (emitted < maxRows) {
    const page: CentralSearchResult = await searchMetaLeadEvents({
      sb: params.sb,
      tenantId: params.tenantId,
      scope: params.scope,
      filters: params.filters,
      cursor,
      limit: Math.min(pageSize, maxRows - emitted),
      leadIdFilter: params.leadIdFilter ?? null,
    });
    // Página vazia com cursor não é o fim: é a varredura a atravessar um bloco
    // de linhas fora do recorte. Parar aqui truncava o export de quem tem
    // recorte estreito.
    if (page.rows.length === 0 && !page.nextCursor) return;
    if (page.rows.length > 0) {
      emitted += page.rows.length;
      emptyRounds = 0;
      yield page.rows;
    } else if (++emptyRounds >= 40) {
      // Teto de segurança: um recorte que não casa com nada não pode varrer a
      // base inteira num pedido de export.
      return;
    }
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

export type CentralFacetOption = { value: string; label: string; count: number };

export type CentralFacets = {
  pages: CentralFacetOption[];
  forms: CentralFacetOption[];
  campaigns: CentralFacetOption[];
  adsets: CentralFacetOption[];
  ads: CentralFacetOption[];
  agents: CentralFacetOption[];
  /** Total considerado para montar as listas (teto de varredura, não total real). */
  sampled: number;
  truncated: boolean;
};

const FACET_SCAN_LIMIT = 5000;

/**
 * Opções do super filtro a partir do próprio período escolhido, e não da
 * página visível. O painel antigo montava os selects com os leads já
 * carregados: campanha antiga simplesmente não aparecia como opção.
 */
export async function loadCentralFacets(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  scope: AccessScope;
  filters: MetaLeadCentralFilters;
}): Promise<CentralFacets> {
  const { sb, tenantId, scope, filters } = params;
  const empty: CentralFacets = {
    pages: [], forms: [], campaigns: [], adsets: [], ads: [], agents: [],
    sampled: 0, truncated: false,
  };
  if (scopeMatchesNothing(scope)) return empty;

  const archiveSupported = await hasArchiveSupport(sb);
  let allowedLeadIds: Set<string> | null = null;
  if (scope.kind !== "all") {
    allowedLeadIds = await visibleLeadIds(sb, tenantId, scope);
    if (allowedLeadIds && allowedLeadIds.size === 0) return empty;
  }

  // As facetas ignoram os próprios recortes de atribuição: senão, escolher uma
  // campanha esvaziava a lista de campanhas e não dava para trocar de opção.
  const facetFilters: MetaLeadCentralFilters = {
    ...filters,
    pageIds: [], formIds: [], campaignIds: [], adsetIds: [], adIds: [], agentIds: [],
    search: "",
  };

  let query = sb
    .from("meta_lead_events")
    .select(
      "page_id, page_name, form_id, form_name, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, agent_id, lead_id",
    )
    .eq("tenant_id", tenantId);
  query = applyCentralFilters(query, facetFilters, { archiveSupported });
  query = query.order("created_at", { ascending: false }).limit(FACET_SCAN_LIMIT);

  const { data, error } = await query;
  if (error) throw new Error(`meta_lead_central_facets_failed: ${error.message}`);

  const rows = (data ?? []) as Array<Record<string, string | null>>;
  const buckets: Record<string, Map<string, { label: string; count: number }>> = {
    pages: new Map(), forms: new Map(), campaigns: new Map(),
    adsets: new Map(), ads: new Map(), agents: new Map(),
  };

  const push = (bucket: string, id: string | null, label: string | null) => {
    if (!id) return;
    const map = buckets[bucket];
    if (!map) return;
    const current = map.get(id);
    if (current) {
      current.count += 1;
      if (!current.label || current.label === id) current.label = label || id;
    } else {
      map.set(id, { label: label || id, count: 1 });
    }
  };

  let counted = 0;
  for (const row of rows) {
    if (allowedLeadIds !== null) {
      const leadId = row.lead_id;
      if (!leadId || !allowedLeadIds.has(leadId)) continue;
    }
    counted += 1;
    push("pages", row.page_id, row.page_name);
    push("forms", row.form_id, row.form_name);
    push("campaigns", row.campaign_id, row.campaign_name);
    push("adsets", row.adset_id, row.adset_name);
    push("ads", row.ad_id, row.ad_name);
    push("agents", row.agent_id, row.agent_id);
  }

  const toOptions = (bucket: string): CentralFacetOption[] =>
    Array.from(buckets[bucket]?.entries() ?? [])
      .map(([value, entry]) => ({ value, label: entry.label, count: entry.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));

  return {
    pages: toOptions("pages"),
    forms: toOptions("forms"),
    campaigns: toOptions("campaigns"),
    adsets: toOptions("adsets"),
    ads: toOptions("ads"),
    agents: toOptions("agents"),
    sampled: counted,
    truncated: rows.length >= FACET_SCAN_LIMIT,
  };
}

/** Total exato do recorte — separado da página porque é a consulta cara. */
export async function countMetaLeadEvents(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  scope: AccessScope;
  filters: MetaLeadCentralFilters;
  leadIdFilter?: Set<string> | null;
}): Promise<{ total: number | null; exact: boolean }> {
  const { sb, tenantId, scope, filters } = params;
  if (scopeMatchesNothing(scope)) return { total: 0, exact: true };

  const archiveSupported = await hasArchiveSupport(params.sb);
  const leadIdFilter = params.leadIdFilter ?? null;

  // Com recorte por equipe/dono a contagem exata exigiria varrer tudo; devolve
  // o total da varredura limitada e sinaliza que é aproximado.
  if (scope.kind !== "all" || leadIdFilter !== null) {
    const scopeIds = scope.kind === "all" ? null : await visibleLeadIds(sb, tenantId, scope);
    const allowed = intersectLeadIds(scopeIds, leadIdFilter);
    if (allowed && allowed.size === 0) return { total: 0, exact: true };
    if (allowed && allowed.size <= SCOPE_INLINE_LIMIT) {
      let query = sb
        .from("meta_lead_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("lead_id", Array.from(allowed));
      query = applyCentralFilters(query, filters, { archiveSupported });
      const { count, error } = await query;
      if (error) throw new Error(`meta_lead_central_count_failed: ${error.message}`);
      return { total: count ?? 0, exact: true };
    }
    // Recorte grande demais para contar sem varrer a base inteira. Devolver
    // "não sei" é melhor do que gastar segundos numa consulta que só alimenta
    // um número no cabeçalho — a Central mostra "N carregados" nesse caso.
    return { total: null, exact: false };
  }

  let query = sb
    .from("meta_lead_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  query = applyCentralFilters(query, filters, { archiveSupported });
  const { count, error } = await query;
  if (error) throw new Error(`meta_lead_central_count_failed: ${error.message}`);
  return { total: count ?? 0, exact: true };
}
