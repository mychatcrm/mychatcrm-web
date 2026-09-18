import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AccessScope } from "@/lib/server/access-scope";
import { iterateMetaLeadEvents } from "@/lib/server/meta-lead-central";
import { resolveLeadOutcomes } from "@/lib/server/meta-lead-outcome";
import { loadCampaignSpend } from "@/lib/server/meta-ads-insights";
import type { MetaLeadCentralFilters } from "@/lib/meta-leads/central-filters";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Desempenho por campanha: do clique ao fechamento, numa linha só.
 *
 * O painel de hoje conta leads recebidos. Isto conta o que aconteceu com eles —
 * quantos responderam, em quanto tempo, quantos agendaram e quantos fecharam —
 * e, quando o cliente concedeu `ads_read`, divide o investimento por cada um
 * desses marcos. É a diferença entre "custo por lead" e "custo por venda".
 */

export type CampaignPerformanceRow = {
  campaignId: string;
  campaignName: string;
  leads: number;
  contacted: number;
  responded: number;
  scheduled: number;
  won: number;
  lost: number;
  medianFirstReplyMinutes: number | null;
  spend: number | null;
  currency: string | null;
  costPerLead: number | null;
  costPerScheduled: number | null;
  costPerWon: number | null;
  metaReportedLeads: number | null;
};

export type CampaignPerformanceResult = {
  rows: CampaignPerformanceRow[];
  totals: {
    leads: number;
    responded: number;
    scheduled: number;
    won: number;
    spend: number | null;
  };
  /** `false` quando a pessoa não pode ver investimento ou a Meta não respondeu. */
  spendAvailable: boolean;
  truncated: boolean;
};

const MAX_ROWS_SCANNED = 20_000;
const UNATTRIBUTED = "__sem_campanha__";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? null);
}

function ratio(spend: number | null, count: number): number | null {
  if (spend === null || count <= 0) return null;
  return Math.round((spend / count) * 100) / 100;
}

export async function buildCampaignPerformance(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  scope: AccessScope;
  filters: MetaLeadCentralFilters;
  includeSpend: boolean;
  leadIdFilter?: Set<string> | null;
}): Promise<CampaignPerformanceResult> {
  const { sb, tenantId, scope, filters, includeSpend } = params;

  type Accumulator = {
    campaignId: string;
    campaignName: string;
    leads: number;
    contacted: number;
    responded: number;
    scheduled: number;
    won: number;
    lost: number;
    replyMinutes: number[];
  };
  const byCampaign = new Map<string, Accumulator>();
  let scanned = 0;
  let truncated = false;

  for await (const page of iterateMetaLeadEvents({
    sb,
    tenantId,
    scope,
    filters,
    maxRows: MAX_ROWS_SCANNED,
    leadIdFilter: params.leadIdFilter ?? null,
  })) {
    scanned += page.length;
    const outcomes = await resolveLeadOutcomes({
      sb,
      tenantId,
      leadIds: page.map((row) => row.lead_id).filter((id): id is string => Boolean(id)),
    });

    for (const row of page) {
      const key = row.campaign_id ?? UNATTRIBUTED;
      const entry =
        byCampaign.get(key) ??
        {
          campaignId: key,
          campaignName: row.campaign_name ?? (key === UNATTRIBUTED ? "Sem campanha" : key),
          leads: 0, contacted: 0, responded: 0, scheduled: 0, won: 0, lost: 0,
          replyMinutes: [],
        };
      if (!byCampaign.has(key)) byCampaign.set(key, entry);
      if (row.campaign_name && entry.campaignName === key) entry.campaignName = row.campaign_name;

      entry.leads += 1;
      // "Contactado" é o que o sistema conseguiu falar, não o que o lead fez.
      if (row.whatsapp_status === "sent") entry.contacted += 1;

      const outcome = row.lead_id ? outcomes.get(row.lead_id) : undefined;
      if (!outcome) continue;
      if (outcome.outcome === "ganho") entry.won += 1;
      if (outcome.outcome === "perdido") entry.lost += 1;
      if (outcome.scheduledAt && outcome.scheduleStatus !== "cancelled") entry.scheduled += 1;
      if (outcome.respondedAt) entry.responded += 1;
      if (typeof outcome.firstReplyMinutes === "number") entry.replyMinutes.push(outcome.firstReplyMinutes);
    }

    if (scanned >= MAX_ROWS_SCANNED) {
      truncated = true;
      break;
    }
  }

  const accumulators = Array.from(byCampaign.values()).sort((a, b) => b.leads - a.leads);

  let spendByCampaign: Map<string, { spend: number; currency: string | null; metaReportedLeads: number }> | null =
    null;
  if (includeSpend && filters.from && filters.to) {
    const realCampaignIds = accumulators
      .map((entry) => entry.campaignId)
      .filter((id) => id !== UNATTRIBUTED);
    if (realCampaignIds.length > 0) {
      const loaded = await loadCampaignSpend({
        sb,
        tenantId,
        campaignIds: realCampaignIds,
        from: filters.from,
        to: filters.to,
      });
      if (loaded) {
        spendByCampaign = new Map(
          Array.from(loaded.entries()).map(([id, value]) => [
            id,
            { spend: value.spend, currency: value.currency, metaReportedLeads: value.metaReportedLeads },
          ]),
        );
      }
    }
  }

  const rows: CampaignPerformanceRow[] = accumulators.map((entry) => {
    const spendEntry = spendByCampaign?.get(entry.campaignId) ?? null;
    const spend = spendEntry?.spend ?? null;
    return {
      campaignId: entry.campaignId,
      campaignName: entry.campaignName,
      leads: entry.leads,
      contacted: entry.contacted,
      responded: entry.responded,
      scheduled: entry.scheduled,
      won: entry.won,
      lost: entry.lost,
      medianFirstReplyMinutes: median(entry.replyMinutes),
      spend,
      currency: spendEntry?.currency ?? null,
      costPerLead: ratio(spend, entry.leads),
      costPerScheduled: ratio(spend, entry.scheduled),
      costPerWon: ratio(spend, entry.won),
      metaReportedLeads: spendEntry?.metaReportedLeads ?? null,
    };
  });

  const totalSpend = spendByCampaign
    ? Array.from(spendByCampaign.values()).reduce((sum, entry) => sum + entry.spend, 0)
    : null;

  return {
    rows,
    totals: {
      leads: rows.reduce((sum, row) => sum + row.leads, 0),
      responded: rows.reduce((sum, row) => sum + row.responded, 0),
      scheduled: rows.reduce((sum, row) => sum + row.scheduled, 0),
      won: rows.reduce((sum, row) => sum + row.won, 0),
      spend: totalSpend,
    },
    spendAvailable: spendByCampaign !== null,
    truncated,
  };
}
