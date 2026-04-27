import type { ClientLead } from "@/lib/dashboard-data";
import { funnelColumnTitle, type CrmFunnel } from "@/lib/crm-funnels";

export const LEAD_EXTRAS_STORAGE_KEY = "mychatcrm-lead-extras-v1";

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

/** Timeline persistida ou seed — usado p.ex. para o termómetro do lead. */
export function getLeadTimelineResolved(
  store: CrmLeadExtrasStore,
  lead: ClientLead,
  funnel?: CrmFunnel,
): CrmTimelineItem[] {
  const custom = store.timeline[lead.id];
  if (custom?.length) return custom;
  return seedTimelineIfEmpty(lead, funnel);
}

function notifyLeadExtrasUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LEAD_EXTRAS_UPDATED_EVENT));
}

/** Garante timeline persistida: se ainda não existir no storage, parte do seed. */
export function appendCrmTimelineEvent(params: {
  leadId: string;
  lead: ClientLead;
  funnel?: CrmFunnel;
  item: CrmTimelineItem;
}): void {
  const store = loadLeadExtras();
  const { leadId, lead, funnel, item } = params;
  const base = store.timeline[leadId]?.length ? store.timeline[leadId]! : seedTimelineIfEmpty(lead, funnel);
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

function parseDataEntrada(lead: ClientLead): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lead.dataEntradaISO.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d);
}

/** Hora do primeiro contacto estável por lead (demo), entre 08:05 e 10:55. */
function primeiroContactoDateTime(lead: ClientLead): Date {
  const base = parseDataEntrada(lead) ?? new Date();
  let acc = 0;
  for (let i = 0; i < lead.id.length; i++) acc += lead.id.charCodeAt(i);
  const minute = 5 + (acc % 51);
  const hour = 8 + Math.floor((acc % 180) / 60);
  const dt = new Date(base);
  dt.setHours(Math.min(hour, 10), minute, 0, 0);
  return dt;
}

function formatAtCompleto(d: Date): string {
  return d.toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAtCurto(d: Date): string {
  return d.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short", hour12: false });
}

function canalTrajecto(origem: string): string {
  const o = origem.toLowerCase();
  if (o.includes("whatsapp"))
    return "WhatsApp Business — conversa iniciada pelo cliente no número público / link wa.me da empresa; a sessão foi atribuída ao funil de vendas.";
  if (o.includes("instagram") || o.includes("tiktok"))
    return "Redes sociais (Meta) — lead tocou no anúncio ou enviou DM; o identificador foi normalizado e associado ao WhatsApp da marca.";
  if (o.includes("facebook"))
    return "Facebook / Messenger — contacto roteado para o fluxo comercial e consolidado no CRM.";
  if (o.includes("google") || o.includes("ads"))
    return "Google Ads / pesquisa paga — clique com gclid (simulado) e conversão para conversa humana/IA.";
  if (o.includes("site") || o.includes("landing") || o.includes("form"))
    return "Site ou formulário — cadastro com consentimento; confirmação de e-mail e telefone (simulado).";
  if (o.includes("indicação") || o.includes("indicacao"))
    return "Indicação — origem manual; primeiro contacto registado quando o cliente escreveu pela primeira vez no canal.";
  return `Trajecto associado à origem «${origem}». Em produção, UTMs, campanha e peça criativa aparecem aqui automaticamente.`;
}

function buildEntradaItem(lead: ClientLead): CrmTimelineItem {
  const quando = primeiroContactoDateTime(lead);
  const at = formatAtCompleto(quando);
  const primeiroNome = lead.nome.trim().split(/\s+/)[0] ?? "Cliente";
  const threadRef = `THR-${lead.id.replace(/[^a-z0-9-]/gi, "").slice(-8).toUpperCase() || "DEMO0001"}`;

  const texto = [
    `${primeiroNome} iniciou o primeiro contacto; o sistema criou o registo do lead no CRM Kanban nesta data e hora (fuso horário do painel).`,
    "",
    `Origem no CRM Kanban: ${lead.origem}.`,
    canalTrajecto(lead.origem),
    `Dados captados no primeiro contacto: telefone ${lead.telefone}; e-mail ${lead.email}.`,
    `Agente IA de entrada que abriu e respondeu à primeira conversa: ${lead.agenteEntrada}.`,
    `Referência interna da thread (demo): ${threadRef}.`,
  ].join("\n");

  return {
    id: `${lead.id}-tl-entrada`,
    at,
    tipo: "entrada",
    titulo: "Primeiro contacto · registo no CRM Kanban",
    texto,
  };
}

/** Movimentações simuladas no funil até à etapa actual do lead (demo). */
function seedSimulatedPipelineMoves(lead: ClientLead, funnel: CrmFunnel | undefined, t0: Date): CrmTimelineItem[] {
  if (!funnel?.columns.length) return [];
  const idx = funnel.columns.findIndex((c) => c.id === lead.status);
  if (idx < 0) return [];

  const items: CrmTimelineItem[] = [];
  let minuteAdd = 12;
  const first = funnel.columns[0]!;
  const dtFirst = new Date(t0);
  dtFirst.setMinutes(dtFirst.getMinutes() + minuteAdd);
  items.push({
    id: `${lead.id}-tl-funil-0`,
    at: formatAtCurto(dtFirst),
    tipo: "pipeline",
    titulo: "Posição no funil após registo",
    texto: `Ao entrar no CRM Kanban, o lead foi colocado na etapa «${first.title}» do funil «${funnel.nome}».`,
  });

  for (let i = 1; i <= idx; i++) {
    minuteAdd += 20 + (i % 4) * 5;
    const dt = new Date(t0);
    dt.setMinutes(dt.getMinutes() + minuteAdd);
    const from = funnel.columns[i - 1]!;
    const to = funnel.columns[i]!;
    items.push({
      id: `${lead.id}-tl-funil-${i}`,
      at: formatAtCurto(dt),
      tipo: "pipeline",
      titulo: "Movimentação no funil",
      texto: `Movido de «${from.title}» para «${to.title}» no CRM Kanban. Cada alteração de coluna fica registada neste histórico.`,
    });
  }
  return items;
}

/**
 * Histórico de demonstração em ordem cronológica (mais antigo → mais recente):
 * primeiro contacto, movimentações no funil, interacções de canal e automações.
 */
export function seedTimelineIfEmpty(lead: ClientLead, funnel?: CrmFunnel): CrmTimelineItem[] {
  const entrada = buildEntradaItem(lead);
  const t0 = primeiroContactoDateTime(lead);
  const pipelineBlock = seedSimulatedPipelineMoves(lead, funnel, t0);

  const audio = new Date(t0);
  audio.setDate(audio.getDate() + 1);
  audio.setHours(16, 10, 0, 0);
  const primeiroNome = lead.nome.trim().split(/\s+/)[0] ?? "Cliente";

  const email = new Date(t0);
  email.setDate(email.getDate() + 1);
  email.setHours(9, 5, 0, 0);

  return [
    entrada,
    ...pipelineBlock,
    {
      id: `${lead.id}-tl-email`,
      at: formatAtCurto(email),
      tipo: "email",
      titulo: "E-mail · proposta comercial",
      texto: "Proposta comercial em PDF enviada para o e-mail do lead com cópia ao responsável comercial.",
    },
    {
      id: `${lead.id}-tl-audio`,
      at: formatAtCurto(audio),
      tipo: "whatsapp",
      titulo: "WhatsApp · mensagem de voz",
      texto: `${primeiroNome} enviou áudio a perguntar valores do plano Master; a transcrição foi anexada ao dossiê (simulação).`,
    },
    {
      id: `${lead.id}-tl-sistema`,
      at: lead.ultimoContato,
      tipo: "sistema",
      titulo: "Automação · sinal de intenção",
      texto: "Bot registrou intenção comercial alta · etiqueta aplicada automaticamente ao perfil do lead.",
    },
  ];
}
