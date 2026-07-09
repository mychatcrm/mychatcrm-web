import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_OFFER_MAX_LEADS } from "@/lib/active-offers-types";
import type { ActiveOfferFilterInput } from "@/lib/active-offers-types";

export type MatchedLeadRow = {
  lead_id: string;
  total_count: number;
};

export function normalizeActiveOfferFilter(input: ActiveOfferFilterInput): Required<
  Pick<ActiveOfferFilterInput, "includeUnassigned" | "excludeOptOut" | "limit">
> &
  ActiveOfferFilterInput {
  const limit = Math.min(Math.max(input.limit ?? ACTIVE_OFFER_MAX_LEADS, 1), ACTIVE_OFFER_MAX_LEADS);
  return {
    kanbanStages: input.kanbanStages?.filter(Boolean) ?? [],
    minDaysInactive: input.minDaysInactive ?? null,
    ownerEmployeeIds: input.ownerEmployeeIds?.filter(Boolean) ?? [],
    includeUnassigned: input.includeUnassigned ?? true,
    sources: input.sources?.filter(Boolean) ?? [],
    excludeOptOut: input.excludeOptOut ?? true,
    limit,
  };
}

export async function matchActiveOfferLeads(
  sb: SupabaseClient,
  tenantId: string,
  filter: ActiveOfferFilterInput,
): Promise<{ leadIds: string[]; matchCount: number }> {
  const normalized = normalizeActiveOfferFilter(filter);
  const { data, error } = await sb.rpc("active_offer_match_leads", {
    p_tenant_id: tenantId,
    p_statuses: normalized.kanbanStages?.length ? normalized.kanbanStages : null,
    p_min_days_inactive: normalized.minDaysInactive ?? null,
    p_owner_ids: normalized.ownerEmployeeIds?.length ? normalized.ownerEmployeeIds : null,
    p_include_unassigned: normalized.includeUnassigned,
    p_sources: normalized.sources?.length ? normalized.sources : null,
    p_exclude_opt_out: normalized.excludeOptOut,
    p_limit: normalized.limit,
    p_offset: 0,
  });

  if (error) {
    throw new Error(error.message || "Erro ao filtrar leads.");
  }

  const rows = (data ?? []) as MatchedLeadRow[];
  const matchCount = rows.length ? Number(rows[0]?.total_count ?? rows.length) : 0;
  const leadIds = rows
    .map((row) => row.lead_id)
    .filter((id): id is string => typeof id === "string");

  return { leadIds, matchCount };
}

export async function fetchSampleLeadsForPreview(
  sb: SupabaseClient,
  tenantId: string,
  leadIds: string[],
  sampleSize = 10,
) {
  const sampleIds = leadIds.slice(0, sampleSize);
  if (!sampleIds.length) return [];

  const { data, error } = await sb
    .from("leads")
    .select("id, name, phone, status, source, owner_employee_id, last_message_at, last_seen, updated_at, created_at")
    .eq("tenant_id", tenantId)
    .in("id", sampleIds);

  if (error) throw new Error("Erro ao carregar amostra de leads.");
  return data ?? [];
}
