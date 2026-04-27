import { KANBAN_COLUMNS } from "./constants";
import type { KanbanColumnId } from "./types";

/**
 * Colunas do pipeline CRM Kanban (mesma lista em `/dashboard/crm` ou equivalente).
 * Quando houver colunas por tenant via API, trocar a implementação mantendo o shape `{ id, title }`.
 */
export function listCrmKanbanColumns(): ReadonlyArray<{ readonly id: KanbanColumnId; readonly title: string }> {
  return KANBAN_COLUMNS;
}

export function isValidCrmKanbanColumnId(value: string): value is KanbanColumnId {
  return KANBAN_COLUMNS.some((c) => c.id === value);
}

/** Converte valor legado (título livre ou id) para um id válido do CRM. */
export function normalizeColunaInicialToCrmColumnId(raw: string): KanbanColumnId {
  if (KANBAN_COLUMNS.some((c) => c.id === raw)) return raw as KanbanColumnId;
  const t = raw.trim().toLowerCase();
  const byTitle = KANBAN_COLUMNS.find((c) => c.title.toLowerCase() === t);
  if (byTitle) return byTitle.id;
  return KANBAN_COLUMNS[0].id;
}

export function crmKanbanColumnTitle(columnId: string): string {
  const col = KANBAN_COLUMNS.find((c) => c.id === columnId);
  return col?.title ?? columnId;
}
