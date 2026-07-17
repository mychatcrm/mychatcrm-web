const MUTATION_INTENT_RE =
  /\b(?:agendar|marcar|criar|cancelar|desmarcar|remarcar|reagendar|alterar|mudar|reschedule|cancel|book|schedule)\b/i;
const SHORT_CONTEXT_FRAGMENT_RE =
  /^\s*(?:oi+|ol[aá]|oie|oide|hello|hi|hola|ok(?:ay)?|sim|s[ií]|yes|pode(?:\s+ser)?|claro|certo|isso|perfeito|obrigad[oa]?|thanks?|gracias|at[eé]\s+mais|tchau|bye)[\s.!?]*$/i;
const AGENDA_READ_FRAGMENT_RE =
  /\b(?:meus?|minhas?|meu|minha|my|mis?)\b[^.!?\n]{0,50}\b(?:agendamentos?|compromissos?|hor[aá]rios?|reuni[oõ]es?|appointments?|meetings?|citas?)\b|\b(?:agendamentos?|compromissos?|appointments?|citas?)\b[^.!?\n]{0,32}\b(?:meus?|minhas?|meu|minha|my|mis?)\b/i;

/**
 * A late fragment was authored before the last agent response but arrived
 * afterwards. Only context-free acknowledgements/greetings and repeated
 * read-only agenda questions are safe to drop. New commands always survive.
 */
export function shouldSuppressLateInboundFragment(params: {
  isLateFragment: boolean;
  kind: string;
  content: string;
}): boolean {
  if (!params.isLateFragment || params.kind !== "text") return false;
  const text = params.content.trim();
  if (!text || text.length > 180 || MUTATION_INTENT_RE.test(text)) return false;
  return SHORT_CONTEXT_FRAGMENT_RE.test(text) || AGENDA_READ_FRAGMENT_RE.test(text);
}
