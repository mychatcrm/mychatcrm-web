import type { ClientLead } from "@/lib/dashboard-data";
import { funnelColumnTitle, type CrmFunnel } from "@/lib/crm-funnels";

/** v2: ignora timelines antigas geradas por seed de demonstração. */
export const LEAD_EXTRAS_STORAGE_KEY = "mychatcrm-lead-extras-v2";

const STORAGE_KEY = LEAD_EXTRAS_STORAGE_KEY;

/** Disparado após `saveLeadExtras` a partir do mesmo separador (ex.: CRM Kanban). */
export const LEAD_EXTRAS_UPDATED_EVENT = "mychatcrm-lead-extras";

export type CrmLeadTask = { id: string; title: string; done: boolean; due?: string };
export type CrmTimelineItem = {
  id: string;
  at: string;
  tipo: "whatsapp" | "email" | "nota" | "sistema" | "entrada" | "pipeline" | "followup";
  /** Linha curta acima do texto (ex.: marco de primeiro contacto). */
  titulo?: string;
  texto: string;
};
export type CrmLeadNote = { id: string; at: string; texto: string; autor?: string };

export type CrmLeadExtrasStore = {
  tasks: Record<string, CrmLeadTask[]>;
  timeline: Record<string, CrmTimelineItem[]>;
  notes: Record<string, CrmLeadNote[]>;
};

function emptyStore(): CrmLeadExtrasStore {
  return { tasks: {}, timeline: {}, notes: {} };
}

export function loadLeadExtras(): CrmLeadExtrasStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const data = JSON.parse(raw) as Partial<CrmLeadExtrasStore>;
    return {
      tasks: typeof data.tasks === "object" && data.tasks ? data.tasks : {},
      timeline: typeof data.timeline === "object" && data.timeline ? data.timeline : {},
      notes: typeof data.notes === "object" && data.notes ? data.notes : {},
    };
  } catch {
    return emptyStore();
  }
}

export function saveLeadExtras(store: CrmLeadExtrasStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Timeline persistida; vazio até eventos reais ou acções no painel. */
export function getLeadTimelineResolved(store: CrmLeadExtrasStore, lead: ClientLead): CrmTimelineItem[] {
  const custom = store.timeline[lead.id];
  return custom?.length ? custom : [];
}

function notifyLeadExtrasUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LEAD_EXTRAS_UPDATED_EVENT));
}

/** Garante timeline persistida; primeiro evento sobre lista vazia. */
export function appendCrmTimelineEvent(params: {
  leadId: string;
  lead: ClientLead;
  funnel?: CrmFunnel;
  item: CrmTimelineItem;
}): void {
  const store = loadLeadExtras();
  const { leadId, item } = params;
  const base = store.timeline[leadId]?.length ? store.timeline[leadId]! : [];
  saveLeadExtras({ ...store, timeline: { ...store.timeline, [leadId]: [...base, item] } });
  notifyLeadExtrasUpdated();
}

export function buildPipelineMoveItem(leadId: string, fromColumnId: string, toColumnId: string, funnel: CrmFunnel | undefined): CrmTimelineItem {
  const fromTitle = funnelColumnTitle(funnel, fromColumnId);
  const toTitle = funnelColumnTitle(funnel, toColumnId);
  const when = new Date();
  return {
    id: `${leadId}-tl-pipe-${when.getTime()}`,
    at: when.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short", hour12: false }),
    tipo: "pipeline",
    titulo: "Movimentação no funil",
    texto:
      funnel?.nome != null
        ? `O lead foi movido de «${fromTitle}» para «${toTitle}» no CRM Kanban (funil «${funnel.nome}»).`
        : `O lead foi movido de «${fromTitle}» para «${toTitle}» no CRM Kanban.`,
  };
}

/** Mantido para compatibilidade; não gera mais eventos fictícios. */
export function seedTimelineIfEmpty(_lead: ClientLead, _funnel?: CrmFunnel): CrmTimelineItem[] {
  return [];
}
