"use client";

import { whatsappHandoffDigits } from "@/lib/whatsapp-handoff";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatIntent = "compra" | "duvida" | "suporte" | "frustracao";

export type HandoffReason =
  | "frustracao"
  | "humano"
  | "lead_quente"
  | "agendamento"
  | "email";

export type LeadRecord = {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  plano?: string;
  timestamp: string;
  resumo_conversa: string;
  handoff_motivo: HandoffReason;
};

export type ChatSessionRecord = {
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  messageCount: number;
  handoff: boolean;
  handoffReason?: HandoffReason;
  lastIntent: ChatIntent;
};

/** Preferências do widget — no servidor a chave OpenAI vem de `OPENAI_API_KEY` ou da chave cifrada em /admin/ia (Supabase). */
export type ChatbotSettings = {
  enabled: boolean;
  whatsappNumber: string;
  assistantName: string;
  welcomeMessage: string;
  suggestions: string[];
};

export const CHATBOT_SETTINGS_KEY = "mychatcrm_chatbot_settings";
export const CHATBOT_LEADS_KEY = "mychatcrm_chatbot_leads";
export const CHATBOT_CONVERSATIONS_KEY = "mychatcrm_chatbot_conversations";
export const CHATBOT_OPENED_KEY = "mychatcrm_chatbot_opened";

export const DEFAULT_CHATBOT_SETTINGS: ChatbotSettings = {
  enabled: true,
  whatsappNumber: whatsappHandoffDigits(),
  assistantName: "Assistente MyChatCRM",
  welcomeMessage:
    "Olá! 👋 Sou o assistente do MyChatCRM.\nPosso te ajudar com dúvidas sobre planos, funcionalidades,\nintegrações ou qualquer coisa sobre a plataforma.\nComo posso te ajudar hoje?",
  suggestions: [
    "💰 Ver planos e preços",
    "🤖 Como funciona a IA?",
    "📱 Conectar meu WhatsApp",
    "🔗 Quais integrações têm?",
    "👨‍💼 Falar com um humano",
  ],
};

const FRUSTRATION_PATTERNS = [
  "irritado",
  "irritada",
  "bravo",
  "brava",
  "com raiva",
  "não funciona",
  "nao funciona",
  "quebrado",
  "horrível",
  "horrivel",
  "péssimo",
  "pessimo",
  "já falei",
  "ja falei",
  "já expliquei",
  "ja expliquei",
  "cansei",
  "absurdo",
  "ridículo",
  "ridiculo",
  "uma vergonha",
  "quero cancelar",
  "vou cancelar",
  "enganação",
  "enganacao",
  "propaganda enganosa",
  "processo",
  "procon",
  "reclamação",
  "reclamacao",
  "falar com humano",
  "falar com pessoa",
  "atendente",
  "gerente",
  "responsável",
  "responsavel",
  "supervisor",
  "me liguem",
  "me ligue",
  "quero ligar",
];

const HOT_LEAD_PATTERNS = [
  "quero contratar",
  "vou contratar",
  "como contrato",
  "quero assinar",
  "vou assinar",
  "aceita cartão",
  "aceita cartao",
  "aceita boleto",
  "parcelado",
  "tem desconto",
  "tem cupom",
  "promoção",
  "promocao",
  "quando começa",
  "quando comeca",
  "como começo",
  "como comeco",
  "primeiros passos",
];

export function normalizeText(text: string) {
  return text.toLowerCase().trim();
}

export function detectFrustration(text: string) {
  const normalized = normalizeText(text);
  return FRUSTRATION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function detectHumanRequest(text: string) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("falar com humano") ||
    normalized.includes("falar com pessoa") ||
    normalized.includes("atendente") ||
    normalized.includes("especialista")
  );
}

export function detectHotLead(text: string) {
  const normalized = normalizeText(text);
  return HOT_LEAD_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function inferIntent(text: string): ChatIntent {
  if (detectFrustration(text)) return "frustracao";
  if (detectHotLead(text)) return "compra";
  const normalized = normalizeText(text);
  if (
    normalized.includes("erro") ||
    normalized.includes("ajuda") ||
    normalized.includes("suporte")
  ) {
    return "suporte";
  }
  return "duvida";
}

export function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: createSessionId(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function formatChatTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function getDefaultHandoffMessage() {
  return (
    "Olá! Estava conversando com o assistente do MyChatCRM e gostaria " +
    "de falar com um especialista."
  );
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function loadChatbotSettings(): ChatbotSettings {
  if (typeof window === "undefined") return DEFAULT_CHATBOT_SETTINGS;
  const saved = safeJsonParse<Record<string, unknown>>(
    window.localStorage.getItem(CHATBOT_SETTINGS_KEY),
    {},
  );
  const enabled = typeof saved.enabled === "boolean" ? saved.enabled : DEFAULT_CHATBOT_SETTINGS.enabled;
  const whatsappNumber =
    typeof saved.whatsappNumber === "string" && saved.whatsappNumber.trim()
      ? saved.whatsappNumber.trim()
      : DEFAULT_CHATBOT_SETTINGS.whatsappNumber;
  const assistantName =
    typeof saved.assistantName === "string" && saved.assistantName.trim()
      ? saved.assistantName.trim()
      : DEFAULT_CHATBOT_SETTINGS.assistantName;
  const welcomeMessage =
    typeof saved.welcomeMessage === "string" && saved.welcomeMessage.trim()
      ? saved.welcomeMessage.trim()
      : DEFAULT_CHATBOT_SETTINGS.welcomeMessage;
  const suggestions = Array.isArray(saved.suggestions)
    ? saved.suggestions.filter((s): s is string => typeof s === "string").slice(0, 5)
    : DEFAULT_CHATBOT_SETTINGS.suggestions;
  return {
    enabled,
    whatsappNumber,
    assistantName,
    welcomeMessage,
    suggestions: suggestions.length ? suggestions : DEFAULT_CHATBOT_SETTINGS.suggestions,
  };
}

export function saveChatbotSettings(settings: ChatbotSettings) {
  if (typeof window === "undefined") return;
  const payload: ChatbotSettings = {
    enabled: settings.enabled,
    whatsappNumber: settings.whatsappNumber,
    assistantName: settings.assistantName,
    welcomeMessage: settings.welcomeMessage,
    suggestions: settings.suggestions?.slice(0, 5) ?? DEFAULT_CHATBOT_SETTINGS.suggestions,
  };
  window.localStorage.setItem(CHATBOT_SETTINGS_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event("storage"));
}

export function loadLeads() {
  if (typeof window === "undefined") return [] as LeadRecord[];
  return safeJsonParse<LeadRecord[]>(window.localStorage.getItem(CHATBOT_LEADS_KEY), []);
}

export function saveLead(record: LeadRecord) {
  if (typeof window === "undefined") return;
  const current = loadLeads();
  window.localStorage.setItem(CHATBOT_LEADS_KEY, JSON.stringify([record, ...current]));
  window.dispatchEvent(new Event("storage"));
}

export function loadConversationRecords() {
  if (typeof window === "undefined") return [] as ChatSessionRecord[];
  return safeJsonParse<ChatSessionRecord[]>(
    window.localStorage.getItem(CHATBOT_CONVERSATIONS_KEY),
    [],
  );
}

export function saveConversationRecord(record: ChatSessionRecord) {
  if (typeof window === "undefined") return;
  const current = loadConversationRecords();
  const next = [record, ...current.filter((item) => item.sessionId !== record.sessionId)].slice(0, 100);
  window.localStorage.setItem(CHATBOT_CONVERSATIONS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("storage"));
}

export function summarizeConversation(messages: ChatMessage[]) {
  return messages
    .slice(-4)
    .map((message) => `${message.role === "user" ? "Cliente" : "Bot"}: ${message.content}`)
    .join(" | ")
    .slice(0, 500);
}

export function hasOpenedChatBefore() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CHATBOT_OPENED_KEY) === "1";
}

export function markChatAsOpened() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHATBOT_OPENED_KEY, "1");
}

export function getPlanMostAsked(leads: LeadRecord[]) {
  const counts = leads.reduce<Record<string, number>>((acc, lead) => {
    const key = lead.plano || "Não informado";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] || "Sem dados";
}
