import type { ClientLead } from "@/lib/dashboard-data";

export const CRM_KANBAN_COLUMN_DROPPABLE_PREFIX = "crm-kanban:";

export type CrmKanbanMove = {
  nextLeads: ClientLead[];
  originalLead: ClientLead;
  movedLead: ClientLead;
  targetStatus: string;
  previousLeadId: string | null;
  nextLeadId: string | null;
  changedColumn: boolean;
};

function reorderColumn(
  leads: ClientLead[],
  funnelId: string,
  status: string,
  orderedIds: string[],
  leadById: Map<string, ClientLead>,
): ClientLead[] {
  const result: ClientLead[] = [];
  let inserted = false;

  for (const lead of leads) {
    if (lead.funilId !== funnelId || lead.status !== status) {
      result.push(lead);
      continue;
    }
    if (inserted) continue;
    for (const id of orderedIds) {
      const orderedLead = leadById.get(id);
      if (orderedLead) result.push(orderedLead);
    }
    inserted = true;
  }

  if (!inserted) {
    for (const id of orderedIds) {
      const orderedLead = leadById.get(id);
      if (orderedLead) result.push(orderedLead);
    }
  }
  return result;
}

/**
 * Calcula uma movimentação do Kanban sem efeitos colaterais. A mesma decisão
 * alimenta a UI otimista e a RPC, evitando que cada camada interprete o drop
 * de uma forma diferente.
 */
export function calculateCrmKanbanMove(params: {
  leads: ClientLead[];
  activeId: string;
  overId: string;
  funnelId: string;
  allowedStatusIds: readonly string[];
}): CrmKanbanMove | null {
  const { leads, activeId, overId, funnelId, allowedStatusIds } = params;
  const originalLead = leads.find((lead) => lead.id === activeId);
  if (!originalLead || originalLead.funilId !== funnelId || activeId === overId) return null;

  const overIsColumn = overId.startsWith(CRM_KANBAN_COLUMN_DROPPABLE_PREFIX);
  const overLead = overIsColumn ? null : leads.find((lead) => lead.id === overId) ?? null;
  const targetStatus = overIsColumn
    ? overId.slice(CRM_KANBAN_COLUMN_DROPPABLE_PREFIX.length)
    : overLead?.status ?? "";

  if (!targetStatus || !allowedStatusIds.includes(targetStatus)) return null;
  if (overLead && overLead.funilId !== funnelId) return null;
  if (overIsColumn && originalLead.status === targetStatus) return null;

  const changedColumn = originalLead.status !== targetStatus;
  const movedLead: ClientLead = {
    ...originalLead,
    funilId: funnelId,
    status: targetStatus,
  };

  const withoutActive = leads.filter((lead) => lead.id !== activeId);
  const targetIds = withoutActive
    .filter((lead) => lead.funilId === funnelId && lead.status === targetStatus)
    .map((lead) => lead.id);

  let insertionIndex = targetIds.length;
  if (!overIsColumn) {
    const overIndex = targetIds.indexOf(overId);
    if (overIndex < 0) return null;

    if (changedColumn) {
      insertionIndex = overIndex;
    } else {
      const originalColumnIds = leads
        .filter((lead) => lead.funilId === funnelId && lead.status === targetStatus)
        .map((lead) => lead.id);
      const oldIndex = originalColumnIds.indexOf(activeId);
      const requestedIndex = originalColumnIds.indexOf(overId);
      if (oldIndex < 0 || requestedIndex < 0 || oldIndex === requestedIndex) return null;
      // Replica a semântica de arrayMove do dnd-kit: o índice observado na
      // lista original é também o índice final desejado.
      insertionIndex = requestedIndex;
    }
  }

  const orderedTargetIds = [...targetIds];
  orderedTargetIds.splice(insertionIndex, 0, activeId);
  const finalIndex = orderedTargetIds.indexOf(activeId);
  const previousLeadId = finalIndex > 0 ? orderedTargetIds[finalIndex - 1]! : null;
  const nextLeadId = finalIndex < orderedTargetIds.length - 1 ? orderedTargetIds[finalIndex + 1]! : null;

  const leadById = new Map(withoutActive.map((lead) => [lead.id, lead]));
  leadById.set(activeId, movedLead);
  const nextLeads = reorderColumn(withoutActive, funnelId, targetStatus, orderedTargetIds, leadById);

  return {
    nextLeads,
    originalLead,
    movedLead,
    targetStatus,
    previousLeadId,
    nextLeadId,
    changedColumn,
  };
}
