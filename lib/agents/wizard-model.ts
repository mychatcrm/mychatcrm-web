import { BRAND } from "@/lib/brand";
import { isValidCrmKanbanColumnId } from "@/lib/crm-kanban-columns";
import {
  DEFAULT_CRM_FUNNELS,
  getCrmFunnelsSnapshot,
  isValidColunaForFunnel,
  normalizeColunaInicialForFunnel,
  resolveAgentFunnelFromCrm,
  type CrmFunnel,
} from "@/lib/crm-funnels";
import type {
  Agent,
  AgentFollowUpInteligente,
  AgentObjective,
  AgentOrigin,
  FollowUp,
  FlowStep,
  KeywordRule,
  OriginType,
} from "@/lib/types";
import { totalWhatsAppLinesForTenant } from "@/lib/whatsapp-connection-storage";
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from "./default-system-prompt-template";

export type AgentWizardDraft = {
  nome: string;
  avatar: string;
  cor: string;
  genero: Agent["genero"];
  objetivo: AgentObjective;
  tom: string;
  delayResposta: number;
  /** Temperatura do modelo (0.01–1). */
  temperatura: number;
  /** Identidade e apresentação perante o cliente (texto curto). */
  promptIdentidade: string;
  promptObjetivo: string;
  systemPrompt: string;
  promptRegrasAdicionais: string;
  respostasProibidas: string;
  /** Frase que pausa o bot só nesta conversa (ex.: humano assume o atendimento). */
  comandoPausaConversa: string;
  /** Frase que volta a ligar o bot nesta conversa. */
  comandoRetomaConversa: string;
  idioma: string;
  arquivosTreinamento: Agent["arquivosTreinamento"];
  origens: AgentOrigin[];
  fluxo: FlowStep[];
  followUps: FollowUp[];
  followUpInteligente: AgentFollowUpInteligente;
  funil: Agent["funil"];
  /** Indice da linha WhatsApp (0 plano, 1+ extras) — ver Integracoes. */
  whatsappSlotIndex: number;
  /** Se falso, CTA/handoff ficam só nas instruções (campos abaixo ocultos). */
  ctaHandoffAtivo: boolean;
  ctaFinal: string;
  handoffKeywords: string[];
  handoffMensagem: string;
  handoffNumero: string;
  foraDaVez: "ignorar" | "padrao" | "mensagem";
  foraDaVezMensagem: string;
};

/** Ordem exibida no passo «Objetivo principal» do wizard. */
export const AGENT_OBJECTIVE_OPTIONS: ReadonlyArray<{ value: AgentObjective; label: string }> = [
  { value: "gerar_leads", label: "Gerar leads" },
  { value: "vender", label: "Vender produto" },
  { value: "suporte", label: "Suporte técnico" },
  { value: "agendar", label: "Agendar reunião" },
  { value: "qualificar", label: "Qualificar lead" },
  { value: "reengajar", label: "Reengajar cliente" },
  { value: "atendimento_geral", label: "Atendimento geral (linha única / secretaria)" },
];

export function agentObjectiveLabel(objetivo: AgentObjective): string {
  return AGENT_OBJECTIVE_OPTIONS.find((o) => o.value === objetivo)?.label ?? objetivo;
}

const WIZARD_ORIGIN_ORDER: readonly OriginType[] = ["lead_ads", "ctw", "keyword", "organico", "crm"];

function defaultWizardOriginRow(tipo: OriginType): AgentOrigin {
  switch (tipo) {
    case "lead_ads":
      return {
        tipo: "lead_ads",
        ativo: false,
        config: { formIds: [], enviarPrimeiro: true, delayPrimeiro: 0, mensagemInicial: "" },
      };
    case "ctw":
      return { tipo: "ctw", ativo: false, config: { adIds: [] } };
    case "keyword":
      return { tipo: "keyword", ativo: false, config: { keywords: [] as KeywordRule[] } };
    case "organico":
      return { tipo: "organico", ativo: true, config: {} };
    case "crm":
      return { tipo: "crm", ativo: false, config: {} };
  }
}

/** Garante as 5 origens esperidas pelo wizard (UI lê `lead_ads` e `ctw` sempre). */
export function normalizeOrigensForWizard(origens: AgentOrigin[]): AgentOrigin[] {
  const byTipo = new Map<OriginType, AgentOrigin>();
  for (const o of origens) {
    byTipo.set(o.tipo, o);
  }
  return WIZARD_ORIGIN_ORDER.map((tipo) => {
    const found = byTipo.get(tipo);
    return found ? ({ ...found, config: { ...found.config } } as AgentOrigin) : defaultWizardOriginRow(tipo);
  });
}

/** Origem por tipo com fallback (UI do passo 3 assume `lead_ads` e `ctw`). */
export function getWizardOrigin(draft: AgentWizardDraft, tipo: OriginType): AgentOrigin {
  return draft.origens.find((o) => o.tipo === tipo) ?? defaultWizardOriginRow(tipo);
}

export function draftFromAgent(agent: Agent): AgentWizardDraft {
  const funnels = getCrmFunnelsSnapshot();
  const resolved = resolveAgentFunnelFromCrm({ ...agent.funil }, funnels);
  const funnel = funnels.find((f) => f.id === resolved.funilId);
  const colunaInicial = normalizeColunaInicialForFunnel(agent.funil.colunaInicial, funnel);
  const waCap = totalWhatsAppLinesForTenant(agent.clientId);
  const rawWa = agent.whatsappSlotIndex ?? 0;
  const whatsappSlotIndex = Math.min(Math.max(0, Math.floor(rawWa)), Math.max(0, waCap - 1));
  return {
    nome: agent.nome,
    avatar: agent.avatar ?? "bot",
    cor: agent.cor,
    genero: agent.genero,
    objetivo: agent.objetivo,
    tom: agent.tom,
    delayResposta: agent.delayResposta,
    temperatura: agent.temperatura ?? 0.2,
    promptIdentidade: agent.promptIdentidade ?? "",
    promptObjetivo: agent.promptObjetivo ?? "",
    systemPrompt: agent.systemPrompt,
    promptRegrasAdicionais: agent.promptRegrasAdicionais ?? "",
    respostasProibidas: agent.respostasProibidas,
    comandoPausaConversa: agent.comandoPausaConversa ?? "",
    comandoRetomaConversa: agent.comandoRetomaConversa ?? "",
    idioma: agent.idioma,
    arquivosTreinamento: agent.arquivosTreinamento,
    origens: normalizeOrigensForWizard(agent.origens),
    fluxo: agent.fluxo,
    followUps: agent.followUps,
    followUpInteligente: agent.followUpInteligente ?? {
      ativo: false,
      tentativasContato: 3,
      intervaloVerificacaoMinutos: 60,
    },
    funil: { ...resolved, colunaInicial },
    whatsappSlotIndex,
    ctaFinal: "Transferir para humano",
    handoffKeywords: ["humano", "especialista"],
    handoffMensagem: "Perfeito! Vou te conectar com nosso especialista agora. Um momento.",
    handoffNumero: "+55 62 9 9999-0000",
    ctaHandoffAtivo: false,
    foraDaVez: "padrao",
    foraDaVezMensagem: "",
  };
}

export function createPromptFromBusiness(context: string, draft: AgentWizardDraft): string {
  const identidade = draft.promptIdentidade.trim();
  return `Você é ${draft.nome || "um agente de IA"}.
${identidade ? `Identidade e apresentação:\n${identidade}\n\n` : ""}Objetivo principal (categoria): ${agentObjectiveLabel(draft.objetivo)}.
Tom de voz: ${draft.tom}.

Contexto do negócio (produto/serviço, oferta e detalhes — complemente o campo «Objetivo» se precisar):
${context || "Sem contexto adicional."}

Regras base:
- Responder em ${draft.idioma}.
- Nunca falar sobre: ${draft.respostasProibidas || "sem restrições explícitas"}.
${
  draft.ctaHandoffAtivo
    ? `- Conduzir para CTA final: ${draft.ctaFinal}.
- Se pedir humano, usar transição: "${draft.handoffMensagem}" e transferir para ${draft.handoffNumero || "equipe responsável"}.`
    : `- CTA final e transferência para humano: seguir as instruções do agente e as regras do negócio acima.`
}
${
  draft.followUpInteligente.ativo
    ? `
- Follow-up inteligente (ativado): ao retomar conversas sem resposta, usar todo o histórico com aquele cliente para redigir uma mensagem nova e precisa — retomar exatamente o assunto, tom e pendências já discutidos; não usar frases genéricas nem modelos fixos.`
    : ""
}
`;
}

/** Validação ao salvar o formulário compacto (uma tela). */
export function validateCompactAgentDraft(
  draft: AgentWizardDraft,
  crmFunnels?: readonly CrmFunnel[],
  tenantId?: string,
): string | null {
  if (!draft.nome.trim()) return "Informe o nome do agente.";
  if (!draft.systemPrompt.trim()) return "Preencha as instruções do agente.";
  if (tenantId && typeof window !== "undefined") {
    const cap = totalWhatsAppLinesForTenant(tenantId);
    const idx = Math.max(0, Math.floor(Number.isFinite(draft.whatsappSlotIndex) ? draft.whatsappSlotIndex : 0));
    if (idx < 0 || idx >= cap) {
      return "Escolha uma linha WhatsApp valida em «Numero WhatsApp do agente» (Integracoes).";
    }
  }
  if (!draft.origens.some((origin) => origin?.ativo)) return "Ative pelo menos uma origem em «Ativação e origens».";
  if (!draft.fluxo.length) return "Mantenha ao menos uma etapa no fluxo.";
  if (crmFunnels?.length) {
    if (!crmFunnels.some((f) => f.id === draft.funil.funilId)) {
      return "Selecione um funil cadastrado em CRM Kanban.";
    }
    const funnel = crmFunnels.find((f) => f.id === draft.funil.funilId)!;
    if (!isValidColunaForFunnel(draft.funil.colunaInicial, funnel)) {
      return "Escolha a coluna inicial entre as etapas do funil selecionado.";
    }
  } else {
    if (!(draft.funil.nomeFunil ?? "").trim()) return "Defina o funil em «Funil no CRM Kanban».";
    if (!isValidCrmKanbanColumnId(draft.funil.colunaInicial))
      return "Escolha a coluna inicial entre as colunas do CRM Kanban.";
  }
  const followUpInteligente = draft.followUpInteligente;
  if (followUpInteligente?.ativo) {
    if ((followUpInteligente.tentativasContato ?? 0) < 1) {
      return "Em «Configurações de Follow-up», defina pelo menos 1 tentativa de contato.";
    }
    if ((followUpInteligente.intervaloVerificacaoMinutos ?? 0) < 1) {
      return "Em «Configurações de Follow-up», o intervalo de verificação deve ser de pelo menos 1 minuto.";
    }
  }
  return null;
}

export const defaultWizardDraft: AgentWizardDraft = {
  nome: "",
  avatar: "bot",
  cor: BRAND.orange,
  genero: "feminino",
  objetivo: "gerar_leads",
  tom: "Profissional",
  delayResposta: 2,
  temperatura: 0.2,
  promptIdentidade: "",
  promptObjetivo: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  promptRegrasAdicionais: "",
  respostasProibidas: "",
  comandoPausaConversa: "",
  comandoRetomaConversa: "",
  idioma: "Português BR",
  arquivosTreinamento: [],
  origens: [
    { tipo: "lead_ads", ativo: false, config: { formIds: [], enviarPrimeiro: true, delayPrimeiro: 0, mensagemInicial: "" } },
    { tipo: "ctw", ativo: false, config: { adIds: [] } },
    { tipo: "keyword", ativo: false, config: { keywords: [] as KeywordRule[] } },
    { tipo: "organico", ativo: true, config: {} },
    { tipo: "crm", ativo: false, config: {} },
  ],
  fluxo: [
    {
      id: "wf-1",
      nome: "Boas-vindas",
      objetivo: "Saudar e identificar intenção principal",
      perguntas: ["Como posso te ajudar hoje?"],
      condicaoAvancar: "perguntas",
      acoesAoCompletar: [{ id: "wfa-1", tipo: "tag", valor: "boas-vindas" }],
      ordem: 1,
    },
  ],
  followUps: [],
  followUpInteligente: {
    ativo: false,
    tentativasContato: 3,
    intervaloVerificacaoMinutos: 60,
  },
  funil: {
    funilId: DEFAULT_CRM_FUNNELS[0]!.id,
    nomeFunil: DEFAULT_CRM_FUNNELS[0]!.nome,
    colunaInicial: DEFAULT_CRM_FUNNELS[0]!.columns[0]!.id,
    tagsEntrada: [],
    origemRelatorio: "Não definido",
    valorEstimado: 0,
    slaHoras: 2,
    maxFollowUps: 0,
  },
  whatsappSlotIndex: 0,
  ctaHandoffAtivo: false,
  ctaFinal: "Transferir para humano",
  handoffKeywords: ["humano", "atendente", "falar com pessoa"],
  handoffMensagem: "Perfeito! Vou te conectar com nosso especialista agora. Um momento.",
  handoffNumero: "",
  foraDaVez: "padrao",
  foraDaVezMensagem: "",
};
