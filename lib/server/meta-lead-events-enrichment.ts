/**
 * Preenche form_name/campaign_name/adset_name/ad_name sob demanda pra leads
 * já registrados em meta_lead_events que nunca passaram pela resolução de
 * atribuição — hoje isso é todo lead bloqueado (ex.: "Sem regra"), porque
 * essa chamada só roda no caminho de sucesso do webhook. Roda na leitura do
 * painel (GET /api/client/meta/lead-events) em vez de no webhook, pra não
 * mexer em lib/server/meta-lead-ingest.ts (em reescrita ativa por outra
 * sessão). Escreve o resultado de volta na linha, então cada evento só
 * paga essa chamada uma vez.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchGraphObjectField, resolveMetaLeadAdAttribution } from "@/lib/server/meta-lead-graph";
import type { MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Teto por requisição — evita que uma lista grande de eventos sem nome deixe o painel lento. */
const MAX_ENRICH_PER_REQUEST = 20;

type ConnectionTokens = { pageAccessToken: string; userAccessToken: string | null };

type NamePatch = {
  form_name?: string;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
};

function needsEnrichment(ev: MetaLeadEventRow): boolean {
  const missingForm = !ev.form_name && Boolean(ev.form_id);
  const missingAdContext = Boolean(ev.ad_id) && (!ev.campaign_name || !ev.adset_name || !ev.ad_name);
  return missingForm || missingAdContext;
}

async function loadConnectionTokens(
  sb: SupabaseServiceClient,
  tenantId: string,
  pageIds: string[],
): Promise<Map<string, ConnectionTokens>> {
  const tokensByPage = new Map<string, ConnectionTokens>();
  if (pageIds.length === 0) return tokensByPage;

  const { data, error } = await sb
    .from("meta_connections")
    .select("page_id, page_access_token, user_access_token")
    .eq("tenant_id", tenantId)
    .in("page_id", pageIds);

  if (error) {
    console.warn("[meta-lead-events-enrichment] connections_query_failed", { tenant_id: tenantId, error: error.message });
    return tokensByPage;
  }

  for (const row of (data ?? []) as Array<{
    page_id: string;
    page_access_token: string | null;
    user_access_token: string | null;
  }>) {
    if (!row.page_access_token?.trim()) continue;
    tokensByPage.set(row.page_id, {
      pageAccessToken: row.page_access_token,
      userAccessToken: row.user_access_token,
    });
  }
  return tokensByPage;
}

async function resolveNamesForEvent(ev: MetaLeadEventRow, tokens: ConnectionTokens): Promise<NamePatch> {
  const patch: NamePatch = {};

  if (!ev.form_name && ev.form_id) {
    const formName = await fetchGraphObjectField(ev.form_id, "name", tokens.pageAccessToken);
    if (formName) patch.form_name = formName;
  }

  if (ev.ad_id && (!ev.campaign_name || !ev.adset_name || !ev.ad_name)) {
    const attribution = await resolveMetaLeadAdAttribution({
      pageAccessToken: tokens.pageAccessToken,
      userAccessToken: tokens.userAccessToken,
      webhookAdId: ev.ad_id,
      webhookAdsetId: ev.adset_id,
      webhookFormId: ev.form_id,
    });
    if (!ev.campaign_name && attribution.campaignName) patch.campaign_name = attribution.campaignName;
    if (!ev.adset_name && attribution.adsetName) patch.adset_name = attribution.adsetName;
    if (!ev.ad_name && attribution.adName) patch.ad_name = attribution.adName;
  }

  return patch;
}

/**
 * Enriquece em memória e persiste no banco (melhor esforço — falha de
 * escrita não derruba a resposta, só significa que tenta de novo no
 * próximo load). Retorna a mesma lista, com os eventos atualizados in-place.
 */
export async function enrichMissingMetaLeadEventNames(
  sb: SupabaseServiceClient,
  tenantId: string,
  events: MetaLeadEventRow[],
): Promise<MetaLeadEventRow[]> {
  const candidates = events.filter(needsEnrichment).slice(0, MAX_ENRICH_PER_REQUEST);
  if (candidates.length === 0) return events;

  const pageIds = Array.from(new Set(candidates.map((ev) => ev.page_id)));
  const tokensByPage = await loadConnectionTokens(sb, tenantId, pageIds);

  await Promise.all(
    candidates.map(async (ev) => {
      const tokens = tokensByPage.get(ev.page_id);
      if (!tokens) return;

      let patch: NamePatch;
      try {
        patch = await resolveNamesForEvent(ev, tokens);
      } catch (err) {
        console.warn("[meta-lead-events-enrichment] resolve_failed", {
          event_id: ev.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (Object.keys(patch).length === 0) return;

      Object.assign(ev, patch);

      const { error } = await sb.from("meta_lead_events").update(patch).eq("id", ev.id);
      if (error) {
        console.warn("[meta-lead-events-enrichment] persist_failed", { event_id: ev.id, error: error.message });
      }
    }),
  );

  return events;
}
