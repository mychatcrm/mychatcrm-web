export const DISPAROS_DRAFTS_STORAGE_KEY = "mychatcrm.disparos.drafts.v1";

export const DISPAROS_DRAFTS_UPDATED_EVENT = "mychatcrm-disparos-drafts-updated";

/** Espelha `PublicoCrmScope`/`PublicoCrmPeriod` do builder de público. */
export type DisparosDraftCrmBlock = {
  scope: { funnelIds: string[]; columnIds: string[] };
  period:
    | { mode: "all" }
    | { mode: "cadastro_dias"; days: number }
    | { mode: "cadastro_data"; date: string }
    | { mode: "sem_contato_dias"; days: number };
};

export type DisparosDraft = {
  id: string;
  name: string;
  /**
   * Só blocos de CRM (escopo + período). Lista importada e contatos digitados
   * já viraram leads reais no momento em que o cliente confirmou o bloco —
   * carregar o rascunho depois não teria como "desfazer" aquilo, então esses
   * blocos não fazem sentido guardar aqui.
   */
  audienceBlocks: DisparosDraftCrmBlock[];
  schedule: string;
  throughput: "suave" | "normal" | "acelerado";
  body: string;
  updatedAt: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

function isDisparosDraftCrmBlock(v: unknown): v is DisparosDraftCrmBlock {
  if (!isRecord(v)) return false;
  if (!isRecord(v.scope) || !isStringArray(v.scope.funnelIds) || !isStringArray(v.scope.columnIds)) return false;
  if (!isRecord(v.period)) return false;
  const period = v.period;
  if (period.mode === "all") return true;
  if (period.mode === "cadastro_data") return typeof period.date === "string";
  if (period.mode === "cadastro_dias" || period.mode === "sem_contato_dias") {
    return typeof period.days === "number" && Number.isFinite(period.days);
  }
  return false;
}

export function isDisparosDraft(v: unknown): v is DisparosDraft {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.body === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.schedule === "string" &&
    Array.isArray(v.audienceBlocks) &&
    (v.throughput === "suave" || v.throughput === "normal" || v.throughput === "acelerado")
  );
}

export function loadDisparosDrafts(): DisparosDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISPAROS_DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // O público mudou de forma (filtro único → escopo + período). Um bloco no
    // formato antigo é descartado, mas o rascunho sobrevive: o texto da
    // mensagem é a parte cara de reescrever, e ele continua válido.
    return parsed.filter(isDisparosDraft).map((draft) => ({
      ...draft,
      audienceBlocks: draft.audienceBlocks.filter(isDisparosDraftCrmBlock),
    }));
  } catch {
    return [];
  }
}

export function persistDisparosDrafts(drafts: DisparosDraft[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISPAROS_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    window.dispatchEvent(new Event(DISPAROS_DRAFTS_UPDATED_EVENT));
  } catch {
    /* quota or private mode */
  }
}
