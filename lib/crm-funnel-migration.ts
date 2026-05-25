import { KANBAN_COLUMNS } from "@/lib/constants";
import type { CrmFunnel, CrmFunnelColumn } from "@/lib/crm-funnels";
import type { KanbanColumnId } from "@/lib/types";

function buildFallbackFunnels(): CrmFunnel[] {
  return [
    {
      id: "funil-default",
      nome: "Funil Principal",
      columns: KANBAN_COLUMNS.map((c) => ({ id: c.id, title: c.title })),
    },
  ];
}

export const CRM_FUNNELS_MIGRATION_VERSION = 2;

const SYSTEM_COLUMN_IDS = new Set<string>(KANBAN_COLUMNS.map((c) => c.id));

const OFFICIAL_TITLE_BY_ID = new Map<string, string>(
  KANBAN_COLUMNS.map((c) => [c.id, c.title]),
);

/** Títulos legados (localStorage antigo) → id de coluna base. */
const LEGACY_TITLE_TO_COLUMN_ID: Record<string, KanbanColumnId> = {
  "novo lead": "novo",
  novo: "novo",
  "em contato": "contato",
  "em contacto": "contato",
  contato: "contato",
  "proposta enviada": "proposta",
  proposta: "proposta",
  negociacao: "negociacao",
  negociação: "negociacao",
  "fechado ✓": "fechado",
  fechado: "fechado",
  "perdido ✗": "perdido",
  perdido: "perdido",
};

export function isSystemKanbanColumnId(columnId: string): boolean {
  return SYSTEM_COLUMN_IDS.has(columnId);
}

export function isCustomFunnelColumnId(columnId: string): boolean {
  return columnId.startsWith("col-") && !isSystemKanbanColumnId(columnId);
}

function isValidColumn(value: unknown): value is CrmFunnelColumn {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && c.id.trim().length > 0 && typeof c.title === "string" && c.title.trim().length > 0;
}

function resolveLegacyColumnId(column: CrmFunnelColumn): string {
  if (isSystemKanbanColumnId(column.id)) return column.id;
  const byTitle = LEGACY_TITLE_TO_COLUMN_ID[column.title.trim().toLowerCase()];
  return byTitle ?? column.id;
}

/**
 * Garante colunas base do Kanban + preserva etapas customizadas (`col-*`).
 */
export function migrateFunnelColumns(columns: CrmFunnelColumn[] | undefined): CrmFunnelColumn[] {
  const input = (columns ?? []).filter(isValidColumn).map((c) => ({
    id: resolveLegacyColumnId(c),
    title: c.title.trim(),
  }));

  const customById = new Map<string, CrmFunnelColumn>();
  for (const col of input) {
    if (!isSystemKanbanColumnId(col.id) && isCustomFunnelColumnId(col.id)) {
      customById.set(col.id, { id: col.id, title: col.title });
    }
  }

  const merged: CrmFunnelColumn[] = KANBAN_COLUMNS.map((base) => ({
    id: base.id,
    title: OFFICIAL_TITLE_BY_ID.get(base.id) ?? base.title,
  }));

  for (const col of input) {
    if (isCustomFunnelColumnId(col.id) && !merged.some((m) => m.id === col.id)) {
      merged.push({ id: col.id, title: col.title });
    }
  }

  for (const [id, col] of customById) {
    if (!merged.some((m) => m.id === id)) merged.push(col);
  }

  return merged.length ? merged : KANBAN_COLUMNS.map((c) => ({ id: c.id, title: c.title }));
}

export function migrateCrmFunnelRow(funnel: CrmFunnel): CrmFunnel {
  return {
    id: funnel.id.trim(),
    nome: funnel.nome.trim(),
    columns: migrateFunnelColumns(funnel.columns),
  };
}

function isCorruptFunnelList(rows: CrmFunnel[]): boolean {
  if (!rows.length) return true;
  return rows.some((f) => !f.id?.trim() || !f.nome?.trim() || !f.columns?.length);
}

/**
 * Id de coluna padrão para leads novos / status desconhecido.
 */
export function pickDefaultKanbanColumnId(columns: readonly CrmFunnelColumn[]): string {
  if (columns.some((c) => c.id === "novo")) return "novo";
  return columns[0]?.id ?? "novo";
}

/**
 * Normaliza status bruto para um id de coluna existente no funil (pós-migração).
 */
export function resolveLeadStatusForFunnelColumns(raw: string, columns: readonly CrmFunnelColumn[]): string {
  const trimmed = raw.trim();
  if (!trimmed) return pickDefaultKanbanColumnId(columns);

  if (columns.some((c) => c.id === trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  const byTitle = columns.find((c) => c.title.toLowerCase() === lower);
  if (byTitle) return byTitle.id;

  const legacyId = LEGACY_TITLE_TO_COLUMN_ID[lower];
  if (legacyId && columns.some((c) => c.id === legacyId)) return legacyId;

  if (lower === "novo" && columns.some((c) => c.id === "novo")) return "novo";

  return pickDefaultKanbanColumnId(columns);
}

export type CrmFunnelMigrationResult = {
  funnels: CrmFunnel[];
  changed: boolean;
  version: number;
};

export function migrateCrmFunnelsFromLocalStorage(parsed: CrmFunnel[] | null): CrmFunnelMigrationResult {
  if (!parsed?.length || isCorruptFunnelList(parsed)) {
    const funnels = buildFallbackFunnels().map((f) => migrateCrmFunnelRow(f));
    return { funnels, changed: true, version: CRM_FUNNELS_MIGRATION_VERSION };
  }

  const migrated = parsed.map((f) => migrateCrmFunnelRow(f));
  const withDefault =
    migrated.some((f) => f.id === "funil-default")
      ? migrated
      : [migrateCrmFunnelRow(buildFallbackFunnels()[0]!), ...migrated];

  const normalized = withDefault.map((f) => ({
    ...f,
    columns: migrateFunnelColumns(f.columns),
  }));

  const changed =
    JSON.stringify(parsed) !== JSON.stringify(normalized) ||
    !parsed.some((f) => f.columns?.some((c) => c.id === "novo"));

  return {
    funnels: normalized,
    changed,
    version: CRM_FUNNELS_MIGRATION_VERSION,
  };
}

export function cloneFunnelsForStorage(funnels: readonly CrmFunnel[]): CrmFunnel[] {
  return funnels.map((f) => ({
    id: f.id,
    nome: f.nome,
    columns: f.columns.map((c) => ({ id: c.id, title: c.title })),
  }));
}
