/**
 * What may be copied into an isolated laboratory agent.
 *
 * This is an allowlist on purpose. A blocklist fails open: the day someone adds a
 * new credential field to agent metadata, a blocklist would copy it into the lab
 * without anyone noticing. Agent metadata really does carry live secrets today —
 * meta_access_token among them — so the default has to be "do not copy".
 */
export const LAB_COPYABLE_AGENT_KEYS = [
  // Prompt and identity
  "instructionMode", "simplePrompt", "systemPrompt", "promptIdentidade", "promptObjetivo",
  "promptRegrasAdicionais", "respostasProibidas", "nome", "name", "description",
  "objetivo", "nomeProduto", "tom", "genero", "idioma", "timezone", "temperatura", "tipo", "fluxo",
  // Conversation behaviour
  "delayResposta", "responseMode", "voiceId", "useHumanPersona", "horario",
  "useSystemToneInstructions", "useSystemWhatsappStyleGuide",
  "smartWaitEnabled", "smartWaitInitialSeconds", "smartWaitMaxSeconds",
  "smartWaitFollowupSeconds", "smartWaitDedupeRepeated",
  "comandoPausaConversa", "comandoRetomaConversa",
  // Journey behaviour that does not point at customer records
  "ctaFinal", "ctaHandoffAtivo", "handoffKeywords", "handoffMensagem",
  "followUps", "followUpInteligente", "agendaLembretes", "agendaDisponibilidade",
  "agendaAutomationEnabled", "leadOutcomeDisqualified", "leadOutcomeLostInterest",
  "origens", "permissoes",
] as const;

/**
 * Keys deliberately left behind, with the reason. Kept explicit so a reviewer can
 * see the decision instead of inferring it from the absence of a key.
 */
export const LAB_WITHHELD_AGENT_KEYS: Record<string, string> = {
  meta_access_token: "Credencial viva da Meta.",
  meta_waba_id: "Identificador da conta WhatsApp do cliente.",
  meta_phone_number_id: "Número da Meta pertencente ao cliente.",
  meta_display_phone: "Número da Meta pertencente ao cliente.",
  handoffNumero: "Telefone de uma pessoa real; notificar terceiros exige autorização explícita.",
  arquivosTreinamento: "Arquivos de treinamento ficam no armazenamento do cliente.",
  crmTargetFunnelId: "Funil do cliente; o laboratório tem os seus próprios.",
  crmTargetColumnId: "Coluna do cliente; o laboratório tem as suas próprias.",
  crmReplyFunnelId: "Funil do cliente.",
  crmReplyColumnId: "Coluna do cliente.",
  agendaCrmScheduleFunnelId: "Funil do cliente.",
  agendaCrmScheduleColumnId: "Coluna do cliente.",
  agendaCrmCancelFunnelId: "Funil do cliente.",
  agendaCrmCancelColumnId: "Coluna do cliente.",
  whatsappSlotIndex: "A conexão do laboratório é outra.",
};

export type LabIsolatedCopy = {
  metadata: Record<string, unknown>;
  withheld: string[];
  unavailable: { dependency: string; reason: string }[];
};

/**
 * Produces the laboratory copy of an agent's configuration. Anything the copy
 * cannot honestly provide is reported as an unavailable dependency, because the
 * plan is explicit that a missing dependency must read as unavailable and never
 * as a passing test.
 */
export function buildLabIsolatedCopy(source: {
  metadata: Record<string, unknown> | null;
  crmAutoMoveEnabled?: boolean | null;
  agendaAutomationEnabled?: boolean | null;
}): LabIsolatedCopy {
  const raw = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const allowed = new Set<string>(LAB_COPYABLE_AGENT_KEYS);
  const metadata: Record<string, unknown> = {};
  const withheld: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.has(key)) metadata[key] = value;
    else if (value !== null && value !== undefined) withheld.push(key);
  }

  const unavailable: { dependency: string; reason: string }[] = [];
  const usesCrm = source.crmAutoMoveEnabled === true
    || ["crmAutoMoveEnabled", "crmMoveOnLeadReplyEnabled", "agendaCrmMoveOnScheduleEnabled", "agendaCrmMoveOnCancelEnabled"]
      .some(key => raw[key] === true);
  if (usesCrm) unavailable.push({ dependency: "crm", reason: "O laboratório não tem os funis do cliente. Movimentações de CRM não serão exercitadas." });
  if (raw.arquivosTreinamento) unavailable.push({ dependency: "knowledge_files", reason: "Os arquivos de treinamento continuam no armazenamento do cliente." });
  if (raw.meta_provider_active === true) unavailable.push({ dependency: "meta_cloud", reason: "A conexão Meta do cliente não é reutilizada pelo laboratório." });
  if (raw.handoffNumero) unavailable.push({ dependency: "handoff", reason: "O número de transferência é de uma pessoa real e não foi copiado." });
  if (source.agendaAutomationEnabled === true || raw.agendaAutomationEnabled === true) {
    unavailable.push({ dependency: "agenda_calendar", reason: "Ligue um Google Calendar exclusivo do laboratório antes de aprovar qualquer teste de agenda." });
  }

  // The copy must never present itself as the customer's agent in a real chat.
  metadata.isSystemAgent = false;
  return { metadata, withheld: withheld.sort(), unavailable };
}
