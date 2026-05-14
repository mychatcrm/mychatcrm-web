import type { ConversationEventRecord } from "@/lib/server/conversation-operation";

export type TimelineMessageLike = {
  id: string;
  created_at: string;
};

export type TimelineEventItem = {
  kind: "event";
  id: string;
  created_at: string;
  title: string;
  detail: string | null;
};

export type TimelineMessageItem<T extends TimelineMessageLike> = {
  kind: "message";
  message: T;
};

export type TimelineItem<T extends TimelineMessageLike> =
  | TimelineEventItem
  | TimelineMessageItem<T>;

export function buildConversationTimeline<T extends TimelineMessageLike>(
  messages: readonly T[],
  events: readonly ConversationEventRecord[],
): Array<TimelineItem<T>> {
  const eventItems: TimelineEventItem[] = events.map((event) => ({
    kind: "event",
    id: event.id,
    created_at: event.created_at,
    title: event.title,
    detail: event.detail,
  }));
  const messageItems: Array<TimelineMessageItem<T>> = messages.map((message) => ({
    kind: "message",
    message,
  }));
  return [...eventItems, ...messageItems].sort(
    (a, b) =>
      new Date(a.kind === "event" ? a.created_at : a.message.created_at).getTime() -
      new Date(b.kind === "event" ? b.created_at : b.message.created_at).getTime(),
  );
}
