export function normalizeInboundTextForDedupe(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export type InboundTextMessage = {
  id: string;
  content: string;
  messageId?: string | null;
  kind?: string;
};

export function deduplicateInboundTexts<T extends InboundTextMessage>(
  messages: T[],
): { messages: T[]; dedupedCount: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const message of messages) {
    const key = normalizeInboundTextForDedupe(message.content);
    if (!key) {
      out.push(message);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(message);
  }
  return { messages: out, dedupedCount: messages.length - out.length };
}

export function buildGroupedUserPrompt(messages: InboundTextMessage[]): string {
  const lines = messages
    .map((m) => m.content.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines[0] ?? "";
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

export function buildTextualReplyFallbackTopics(messages: InboundTextMessage[]): string | null {
  const unique = deduplicateInboundTexts(messages).messages;
  if (unique.length <= 1) return null;
  const snippets = unique
    .map((m) => m.content.trim())
    .filter((t) => t.length > 0 && t.length <= 120)
    .slice(0, 4);
  if (!snippets.length) return null;
  return snippets.map((s) => `Sobre "${s}"`).join(". ");
}
