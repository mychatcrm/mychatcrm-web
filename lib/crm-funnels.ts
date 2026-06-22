import type { AgentFunnel } from "./types";
import { isValidCrmKanbanColumnId, listCrmKanbanColumns, normalizeColunaInicialToCrmColumnId } from "./crm-kanban-columns";
import {
  CRM_FUNNELS_MIGRATION_VERSION,
  migrateCrmFunnelRow,
  migrateCrmFunnelsFromLocalStorage,
  migrateFunnelColumns,
  pickDefaultKanbanColumnId,
  resolveLeadStatusForFunnelColumns,
} from "./crm-funnel-migration";

export type CrmFunnelColumn = { id: string; title: string };

export type CrmFunnel = { id: string; nome: string; columns: CrmFunnelColumn[] };

export const CRM_FUNNELS_STORAGE_KEY = "mychatcrm-crm-funnels-v1";

export { CRM_FUNNELS_MIGRATION_VERSION, migrateCrmFunnelsFromLocalStorage, migrateFunnelColumns };

export function templateColumnsFromGlobalKanban(): CrmFunnelColumn[] {
  return migrateFunnelColumns(
    listCrmKanbanColumns().map((c) => ({ id: c.id, title: c.title })),
    { template: "full" },
  );
}

/** Funil inicial com pipeline próprio (colunas copiadas do modelo global na primeira instalação). */
export const DEFAULT_CRM_FUNNELS: CrmFunnel[] = [
  {
    id: "funil-default",
    nome: "Funil Principal",
    columns: templateColumnsFromGlobalKanban(),
  },
];

const LEGACY_DEFAULT_FUNNEL_IDS = ["funil-default", "funil-imoveis-zs", "funil-suporte", "funil-campanha-verao"] as const;

function isLegacyFourPack(rows: CrmFunnel[]): boolean {
  if (rows.length !== LEGACY_DEFAULT_FUNNEL_IDS.length) return false;
  return LEGACY_DEFAULT_FUNNEL_IDS.every((id, i) => rows[i]?.id === id);
}

function isCrmColumn(value: unknown): value is CrmFunnelColumn {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === "string" && c.id.trim().length > 0 && typeof c.title === "string" && c.title.trim().length > 0;
}

function isCrmFunnelRow(value: unknown): value is CrmFunnel {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return false;
  if (typeof row.nome !== "string" || !row.nome.trim()) return false;
  if (row.columns === undefined) return true;
  if (!Array.isArray(row.columns)) return false;
  return row.columns.every(isCrmColumn);
}

export function normalizeCrmFunnelRow(row: CrmFunnel): CrmFunnel {
  return migrateCrmFunnelRow(row);
}

export function parseCrmFunnelsJson(raw: string | null): CrmFunnel[] | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    const rows = data.filter(isCrmFunnelRow).map((r) => normalizeCrmFunnelRow(r as CrmFunnel));
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

export function cloneFunnels(funnels: readonly CrmFunnel[]): CrmFunnel[] {
  return funnels.map((f) => ({ ...f, columns: f.columns.map((c) => ({ ...c })) }));
}

function loadAndMigrateStoredFunnels(): CrmFunnel[] {
  if (typeof window === "undefined") return cloneFunnels(DEFAULT_CRM_FUNNELS);

  const fromStorage = parseCrmFunnelsJson(window.localStorage.getItem(CRM_FUNNELS_STORAGE_KEY));
  if (fromStorage && isLegacyFourPack(fromStorage)) {
    const next = cloneFunnels(DEFAULT_CRM_FUNNELS);
    persistCrmFunnels(next);
    return next;
  }

  const { funnels, changed } = migrateCrmFunnelsFromLocalStorage(fromStorage);
  const next = cloneFunnels(funnels);
  if (changed || !fromStorage) {
    persistCrmFunnels(next);
  }
  return next;
}

/** Lista completa para o painel e formulários (SSR: só defaults). */
export function getCrmFunnelsSnapshot(): CrmFunnel[] {
  if (typeof window === "undefined") return cloneFunnels(DEFAULT_CRM_FUNNELS);
  return loadAndMigrateStoredFunnels();
}

export function persistCrmFunnels(funnels: CrmFunnel[]): void {
  if (typeof window === "undefined") return;
  const migrated = migrateCrmFunnelsFromLocalStorage(funnels).funnels;
  window.localStorage.setItem(CRM_FUNNELS_STORAGE_KEY, JSON.stringify(migrated));
}

/** Recria funis locais a partir do modelo oficial (preserva outros funis customizados quando possível). */
export function resetCrmFunnelsToSafeDefaults(): CrmFunnel[] {
  const { funnels } = migrateCrmFunnelsFromLocalStorage(null);
  const next = cloneFunnels(funnels);
  persistCrmFunnels(next);
  return next;
}

export function newCrmFunnelId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : String(Date.now());
  return `funil-${suffix}`;
}

export function newFunnelColumnId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : String(Date.now());
  return `col-${suffix}`;
}

/** Garante `funilId` + `nomeFunil` coerentes com a lista atual do CRM. */
export function resolveAgentFunnelFromCrm(funil: AgentFunnel, funnels: readonly CrmFunnel[]): AgentFunnel {
  if (!funnels.length) return funil;
  const byId = funnels.find((f) => f.id === funil.funilId);
  if (byId) return { ...funil, funilId: byId.id, nomeFunil: byId.nome };
  const nome = (funil.nomeFunil ?? "").trim().toLowerCase();
  const byNome = funnels.find((f) => f.nome.trim().toLowerCase() === nome);
  if (byNome) return { ...funil, funilId: byNome.id, nomeFunil: byNome.nome };
  const first = funnels[0]!;
  return { ...funil, funilId: first.id, nomeFunil: first.nome };
}

export function funnelColumnTitle(funnel: CrmFunnel | undefined, columnId: string): string {
  const normalized = funnel ? migrateCrmFunnelRow(funnel) : undefined;
  return normalized?.columns.find((c) => c.id === columnId)?.title ?? columnId;
}

/** Normaliza `colunaInicial` (id da etapa) para o pipeline do funil indicado. */
export function normalizeColunaInicialForFunnel(raw: string, funnel: CrmFunnel | undefined): string {
  if (!funnel?.columns?.length) return normalizeColunaInicialToCrmColumnId(raw);
  const cols = migrateFunnelColumns(funnel.columns);
  return resolveLeadStatusForFunnelColumns(raw, cols);
}

export function isValidColunaForFunnel(columnId: string, funnel: CrmFunnel | undefined): boolean {
  if (!funnel?.columns?.length) return isValidCrmKanbanColumnId(columnId);
  const cols = migrateFunnelColumns(funnel.columns);
  return cols.some((c) => c.id === columnId);
}

export function getFunnelInitialColumnId(funnel: CrmFunnel | undefined): string {
  const cols = funnel?.columns?.length ? migrateFunnelColumns(funnel.columns) : templateColumnsFromGlobalKanban();
  return pickDefaultKanbanColumnId(cols);
}
