import { normalizeColunaInicialForFunnel, type CrmFunnel } from "@/lib/crm-funnels";
import type { ClientLead } from "@/lib/dashboard-data";

export type CrmVisibilityDiagnostics = {
  receivedFromApi: number;
  afterNormalization: number;
  afterSearch: number;
  afterScope: number;
  visibleInActiveFunnel: number;
  visibleInKanban: number;
  activeFunnelId: string | null;
  availableFunnels: string[];
  availableStatuses: string[];
  discardedBySearch: number;
  discardedByScope: number;
  discardedByFunnel: number;
  discardedByFilters: number;
};

export function preferredDefaultCrmFunnelId(funnels: readonly CrmFunnel[]): string {
  return funnels.find((f) => f.id === "funil-default")?.id ?? funnels[0]?.id ?? "";
}

export function normalizeLeadsForVisibleCrmFunnel(
  leads: ClientLead[],
  funnels: readonly CrmFunnel[],
): ClientLead[] {
  const fallbackFunnel = funnels.find((f) => f.id === "funil-default") ?? funnels[0];
  if (!fallbackFunnel) return leads.map((lead) => ({ ...lead }));

  return leads.map((lead) => {
    const funnel = funnels.find((f) => f.id === lead.funilId) ?? fallbackFunnel;
    const status = normalizeColunaInicialForFunnel(lead.status, funnel);
    if (lead.funilId === funnel.id && lead.status === status) return { ...lead };
    return { ...lead, funilId: funnel.id, status };
  });
}

export function buildCrmVisibilityDiagnostics(params: {
  receivedFromApi: number;
  normalizedLeads: readonly ClientLead[];
  searchFiltered: readonly ClientLead[];
  scopeFiltered: readonly ClientLead[];
  pipelineBase: readonly ClientLead[];
  pipelineLeads: readonly ClientLead[];
  activeFunnel?: CrmFunnel | null;
  funnels: readonly CrmFunnel[];
}): CrmVisibilityDiagnostics {
  return {
    receivedFromApi: params.receivedFromApi,
    afterNormalization: params.normalizedLeads.length,
    afterSearch: params.searchFiltered.length,
    afterScope: params.scopeFiltered.length,
    visibleInActiveFunnel: params.pipelineBase.length,
    visibleInKanban: params.pipelineLeads.length,
    activeFunnelId: params.activeFunnel?.id ?? null,
    availableFunnels: params.funnels.map((f) => f.id),
    availableStatuses: params.activeFunnel?.columns.map((c) => c.id) ?? [],
    discardedBySearch: Math.max(0, params.normalizedLeads.length - params.searchFiltered.length),
    discardedByScope: Math.max(0, params.searchFiltered.length - params.scopeFiltered.length),
    discardedByFunnel: Math.max(0, params.scopeFiltered.length - params.pipelineBase.length),
    discardedByFilters: Math.max(0, params.pipelineBase.length - params.pipelineLeads.length),
  };
}
