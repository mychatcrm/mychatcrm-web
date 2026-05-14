/** Detecta se a resposta repete trecho longo das últimas outbound (anti-repetição leve). */
export function detectOutboundRepetition(
  reply: string,
  recentOutbound: string[],
  minPhraseLength = 30,
): string | null {
  const normalizedReply = reply.trim().toLowerCase();
  if (normalizedReply.length < minPhraseLength) return null;

  for (const prior of recentOutbound) {
    const chunk = prior.trim().toLowerCase();
    if (chunk.length < minPhraseLength) continue;
    if (normalizedReply.includes(chunk) || chunk.includes(normalizedReply.slice(0, minPhraseLength))) {
      return prior.slice(0, 80);
    }
  }
  return null;
}
