"use client";

import { CRM_LEAD_SEM_OWNER_LABEL, type ClientLead } from "@/lib/dashboard-data";
import { loadCrmLeadsSnapshot, persistCrmLeadsSnapshot } from "@/lib/crm-leads-storage";
import { loadLeadDistributionRules, persistLeadDistributionRules } from "@/lib/lead-distribution-rules";
import type { TeamEmployee } from "@/lib/team-employees-types";

function stripEmployeeIdsFromLeadRules(tenantId: string, removedIds: Set<string>) {
  const rules = loadLeadDistributionRules(tenantId);
  const next = rules.map((r) => ({
    ...r,
    employeeIds: r.employeeIds.filter((id) => !removedIds.has(id)),
  }));
  persistLeadDistributionRules(tenantId, next);
}

function orphanLeadsForRemovedEmployees(
  tenantId: string,
  removed: TeamEmployee[],
  fallbackLeads: ClientLead[],
): void {
  const removedIds = new Set(removed.map((r) => r.id));
  const nomeKeys = new Set(
    removed.map((r) => r.nome.trim().toLowerCase()).filter((n) => n.length > 0),
  );
  const emailKeys = new Set(
    removed.map((r) => r.email.trim().toLowerCase()).filter((e) => e.length > 0 && !e.includes("legacy-sem-email")),
  );

  const leads = loadCrmLeadsSnapshot(tenantId, fallbackLeads);
  const next = leads.map((lead) => {
    if (lead.ownerEmployeeId && removedIds.has(lead.ownerEmployeeId)) {
      return { ...lead, ownerEmployeeId: undefined, responsavel: CRM_LEAD_SEM_OWNER_LABEL };
    }
    const resp = lead.responsavel.trim().toLowerCase();
    if (nomeKeys.has(resp) || emailKeys.has(resp)) {
      return { ...lead, ownerEmployeeId: undefined, responsavel: CRM_LEAD_SEM_OWNER_LABEL };
    }
    return lead;
  });
  persistCrmLeadsSnapshot(tenantId, next);
}

/** Após remoção no servidor: leads sem dono + regras sem ids removidos (localStorage). */
export function applyClientSideCleanupAfterEmployeeRemoval(
  tenantId: string,
  removedProfiles: TeamEmployee[],
  removedIds: Set<string>,
  fallbackLeads: ClientLead[],
) {
  orphanLeadsForRemovedEmployees(tenantId, removedProfiles, fallbackLeads);
  stripEmployeeIdsFromLeadRules(tenantId, removedIds);
}
