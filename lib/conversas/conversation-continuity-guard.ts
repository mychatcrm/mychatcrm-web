const CONTINUATION_MESSAGE_RE =
  /^(?:oi|ol[aá]|opa|ok|okay|sim|n[aã]o|pode|pode ser|t[aá]|certo|beleza|entendi|tranquilo)[\s.!?]*$/i;

/**
 * Barreira determinística para um erro que prompt sozinho não consegue impedir:
 * em uma conversa ativa, uma saudação/ack curto não pode fazer o agente se
 * apresentar ou abrir o atendimento novamente.
 */
export function preserveActiveConversationContinuity(params: {
  reply: string;
  clientText: string;
  activeConversation: boolean;
}): string {
  const original = params.reply.trim();
  if (!params.activeConversation || !CONTINUATION_MESSAGE_RE.test(params.clientText.trim())) {
    return original;
  }

  let text = original;
  text = text.replace(
    /^(?:oi|ol[aá]|opa|bom dia|boa tarde|boa noite)(?:,\s*[^!?.\n]{1,50})?[!?.;,]*\s*/i,
    "",
  );
  text = text.replace(/^(?:tudo bem|como (?:voc[eê]|vc) (?:est[aá]|vai))\??\s*/i, "");
  text = text.replace(
    /^(?:vamos|podemos)\s+(?:continuar|retomar)(?:\s+(?:nossa|a|essa))?\s+conversa(?:\s+sobre[^.!?\n]*)?[.!?]*\s*/i,
    "",
  );

  return text.trim() || original;
}
