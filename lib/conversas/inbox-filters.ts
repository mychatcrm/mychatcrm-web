import type { ConversationMode } from "@/lib/server/conversation-operation";

export type InboxTab = "all" | "automation" | "human";

export type InboxConversationMeta = {
  remoteJid: string;
  conversation_mode?: ConversationMode | null;
};

export function filterConversationsByInboxTab<T extends InboxConversationMeta>(
  conversations: readonly T[],
  tab: InboxTab,
): T[] {
  if (tab === "all") return [...conversations];
  if (tab === "automation") {
    return conversations.filter((conversation) => conversation.conversation_mode === "automation");
  }
  return conversations.filter(
    (conversation) =>
      conversation.conversation_mode === "human" ||
      conversation.conversation_mode === "waiting_human",
  );
}
