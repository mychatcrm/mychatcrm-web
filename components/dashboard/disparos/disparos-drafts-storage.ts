export const DISPAROS_DRAFTS_STORAGE_KEY = "mychatcrm.disparos.drafts.v1";

export const DISPAROS_DRAFTS_UPDATED_EVENT = "mychatcrm-disparos-drafts-updated";

/** Só filtros do CRM são salváveis num rascunho — ver DisparosDraft. */
export type DisparosDraftCrmBlock = { filtro: "todos" | "tag" | "etapa" | "dias" | "data"; valor: string };

export type DisparosDraft = {
  id: string;
  name: string;
  /**
   * Só blocos de CRM (filtro + valor). Lista importada e contatos digitados
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

function isDisparosDraftCrmBlock(v: unknown): v is DisparosDraftCrmBlock {
  if (!isRecord(v)) return false;
  return (
    (v.filtro === "todos" || v.filtro === "tag" || v.filtro === "etapa" || v.filtro === "dias" || v.filtro === "data") &&
    typeof v.valor === "string"
  );
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
    v.audienceBlocks.every(isDisparosDraftCrmBlock) &&
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
    return parsed.filter(isDisparosDraft);
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
