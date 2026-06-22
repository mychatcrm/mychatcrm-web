import { KANBAN_COLUMNS } from "@/lib/constants";

const SYSTEM_STATUS_IDS = new Set<string>(KANBAN_COLUMNS.map((c) => c.id));

const CUSTOM_COLUMN_ID = /^col-[a-z0-9]+$/i;

export function normalizeAllowedStatusIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (clean) seen.add(clean);
  }
  return [...seen];
}

/**
 * Valida status de lead no update (PUT / bulk).
 * Sem allowedStatusIds, aceita ids oficiais + colunas custom `col-*`.
 */
export function validateLeadStatusForUpdate(
  status: string,
  allowedStatusIds?: string[],
): string | null {
  const trimmed = status.trim();
  if (!trimmed) return "Status inválido.";

  if (allowedStatusIds?.length) {
    return allowedStatusIds.includes(trimmed) ? null : "Status não permitido para este funil.";
  }

  if (SYSTEM_STATUS_IDS.has(trimmed)) return null;
  if (CUSTOM_COLUMN_ID.test(trimmed)) return null;
  return "Status inválido.";
}

export function validateLeadFunnelIdForUpdate(funilId: string): string | null {
  const trimmed = funilId.trim();
  if (!trimmed) return "Funil inválido.";
  if (!/^funil-[a-z0-9-]+$/i.test(trimmed) && trimmed !== "funil-default") {
    return "Funil inválido.";
  }
  return null;
}
