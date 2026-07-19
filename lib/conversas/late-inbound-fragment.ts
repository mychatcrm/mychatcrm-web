const MUTATION_INTENT_RE =
  /\b(?:agendar|marcar|criar|cancelar|desmarcar|remarcar|reagendar|alterar|mudar|reschedule|cancel|book|schedule)\b/i;
const SHORT_CONTEXT_FRAGMENT_RE =
  /^\s*(?:oi+|ol[aá]|oie|oide|hello|hi|hola|ok(?:ay)?|sim|s[ií]|yes|pode(?:\s+ser)?|claro|certo|isso|perfeito|obrigad[oa]?|thanks?|gracias|at[eé]\s+mais|tchau|bye)[\s.!?]*$/i;

/**
 * A late fragment was authored before the last agent response but arrived
 * afterwards. Only context-free acknowledgements/greetings are safe to drop.
 * Agenda-read questions ("tem algum agendamento meu?") must NEVER be dropped —
 * they are real user intent that the existing read path should answer.
 */
export function shouldSuppressLateInboundFragment(params: {
  isLateFragment: boolean;
  kind: string;
  content: string;
}): boolean {
  if (!params.isLateFragment || params.kind !== "text") return false;
  const text = params.content.trim();
  if (!text || text.length > 180 || MUTATION_INTENT_RE.test(text)) return false;
  return SHORT_CONTEXT_FRAGMENT_RE.test(text);
}
