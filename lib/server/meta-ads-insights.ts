import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { metaGraphErrorCode, metaGraphRequest } from "@/lib/server/meta-graph-api";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Investimento por campanha, lido da Meta com o token do próprio cliente.
 *
 * O escopo `ads_read` já é pedido no OAuth desde o início (é o que permite
 * resolver campanha/conjunto/anúncio de cada lead), e a leitura de objetos de
 * conta de anúncio precisa do token de USUÁRIO — o de página devolve "does not
 * exist" mesmo com a permissão concedida.
 *
 * Com gasto de um lado e desfecho do outro, o cliente deixa de olhar CPL de
 * vaidade e passa a ver custo por agendamento e custo por venda.
 */

export type CampaignSpend = {
  campaignId: string;
  campaignName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  currency: string | null;
  metaReportedLeads: number;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GRAPH_TIMEOUT_MS = 12_000;
const MAX_CAMPAIGNS = 60;

type GraphInsight = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  account_currency?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A Meta conta lead em `actions`, com nome diferente conforme o tipo de anúncio. */
function readLeadActions(actions: GraphInsight["actions"]): number {
  if (!Array.isArray(actions)) return 0;
  for (const action of actions) {
    const type = action?.action_type;
    if (type === "leadgen.other" || type === "lead" || type === "onsite_conversion.lead_grouped") {
      return toNumber(action?.value);
    }
  }
  return 0;
}

async function loadUserToken(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("meta_connections")
    .select("user_access_token, page_access_token")
    .eq("tenant_id", tenantId)
    .not("user_access_token", "is", null)
    .limit(1)
    .maybeSingle();
  const row = data as { user_access_token?: string | null } | null;
  return row?.user_access_token?.trim() || null;
}

type CacheRow = {
  object_id: string;
  object_name: string | null;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  reach: number | string;
  currency: string | null;
  meta_reported_leads: number;
  expires_at: string;
};

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

/**
 * Gasto por campanha no período, com cache. Devolve `null` quando não dá para
 * saber — sem token de usuário, sem permissão ou sem a tabela de cache — em vez
 * de devolver zero, que o painel mostraria como "campanha de graça".
 */
export async function loadCampaignSpend(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  campaignIds: string[];
  from: string;
  to: string;
}): Promise<Map<string, CampaignSpend> | null> {
  const { sb, tenantId, from, to } = params;
  const campaignIds = Array.from(new Set(params.campaignIds.filter(Boolean))).slice(0, MAX_CAMPAIGNS);
  if (campaignIds.length === 0) return new Map();

  const result = new Map<string, CampaignSpend>();
  const now = Date.now();

  const { data: cached, error: cacheError } = await sb
    .from("meta_ads_insights_cache")
    .select(
      "object_id, object_name, spend, impressions, clicks, reach, currency, meta_reported_leads, expires_at",
    )
    .eq("tenant_id", tenantId)
    .eq("level", "campaign")
    .eq("period_from", from)
    .eq("period_to", to)
    .in("object_id", campaignIds);

  if (cacheError && MISSING_TABLE_CODES.has(cacheError.code ?? "")) return null;

  const fresh = new Set<string>();
  for (const row of (cached ?? []) as unknown as CacheRow[]) {
    if (new Date(row.expires_at).getTime() <= now) continue;
    fresh.add(row.object_id);
    result.set(row.object_id, {
      campaignId: row.object_id,
      campaignName: row.object_name,
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      reach: toNumber(row.reach),
      currency: row.currency,
      metaReportedLeads: toNumber(row.meta_reported_leads),
    });
  }

  const pending = campaignIds.filter((id) => !fresh.has(id));
  if (pending.length === 0) return result;

  const token = await loadUserToken(sb, tenantId);
  if (!token) return result.size > 0 ? result : null;

  const timeRange = JSON.stringify({ since: from, until: to });
  const rowsToUpsert: Record<string, unknown>[] = [];

  for (const campaignId of pending) {
    try {
      const response = await metaGraphRequest<{ data?: GraphInsight[] }>(
        `/${encodeURIComponent(campaignId)}/insights`,
        {
          accessToken: token,
          searchParams: {
            fields: "spend,impressions,clicks,reach,account_currency,actions",
            time_range: timeRange,
            level: "campaign",
          },
          timeoutMs: GRAPH_TIMEOUT_MS,
        },
      );
      const insight = response.data?.[0];
      if (!insight) continue;

      const spend: CampaignSpend = {
        campaignId,
        campaignName: null,
        spend: toNumber(insight.spend),
        impressions: toNumber(insight.impressions),
        clicks: toNumber(insight.clicks),
        reach: toNumber(insight.reach),
        currency: insight.account_currency ?? null,
        metaReportedLeads: readLeadActions(insight.actions),
      };
      result.set(campaignId, spend);
      rowsToUpsert.push({
        tenant_id: tenantId,
        level: "campaign",
        object_id: campaignId,
        period_from: from,
        period_to: to,
        spend: spend.spend,
        impressions: spend.impressions,
        clicks: spend.clicks,
        reach: spend.reach,
        currency: spend.currency,
        meta_reported_leads: spend.metaReportedLeads,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(now + CACHE_TTL_MS).toISOString(),
      });
    } catch (error) {
      // Campanha sem permissão ou apagada não pode derrubar o painel inteiro.
      console.warn("[meta-ads-insights] campaign_failed", {
        tenant_id: tenantId,
        campaign_id: campaignId,
        code: metaGraphErrorCode(error),
      });
    }
  }

  if (rowsToUpsert.length > 0) {
    const { error } = await sb
      .from("meta_ads_insights_cache")
      .upsert(rowsToUpsert, { onConflict: "tenant_id,level,object_id,period_from,period_to" });
    if (error && !MISSING_TABLE_CODES.has(error.code ?? "")) {
      console.warn("[meta-ads-insights] cache_write_failed", { tenant_id: tenantId, error: error.message });
    }
  }

  return result.size > 0 ? result : null;
}
