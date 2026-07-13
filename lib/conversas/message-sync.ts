export type MessageSendStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export type SyncChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: string;
  content: string;
  media_url?: string | null;
  agent_id?: string | null;
  created_at: string;
  client_temp_id?: string | null;
  send_status?: MessageSendStatus | null;
  delivery_status?: string | null;
};

export function createClientTempId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `temp-${crypto.randomUUID()}`;
  }
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createOptimisticOutboundMessage(params: {
  text: string;
  clientTempId: string;
  kind?: SyncChatMessage["kind"];
  mediaUrl?: string | null;
}): SyncChatMessage {
  const now = new Date().toISOString();
  return {
    id: params.clientTempId,
    client_temp_id: params.clientTempId,
    direction: "outbound",
    kind: params.kind ?? "text",
    content: params.text,
    media_url: params.mediaUrl ?? null,
    agent_id: "human",
    created_at: now,
    send_status: "sending",
    delivery_status: "pending",
  };
}

export function isOptimisticMessageId(id: string): boolean {
  return id.startsWith("temp-");
}

export function messagesMatchForDedup(a: SyncChatMessage, b: SyncChatMessage): boolean {
  if (a.id === b.id) return true;
  const tempA = a.client_temp_id?.trim();
  const tempB = b.client_temp_id?.trim();
  if (tempA && tempB && tempA === tempB) return true;
  if (tempA && (b.id === tempA || a.id === tempB)) return true;
  return false;
}

export function shouldSkipRealtimeInsert(
  existing: readonly SyncChatMessage[],
  incoming: SyncChatMessage,
): boolean {
  return existing.some((message) => messagesMatchForDedup(message, incoming));
}

export function reconcileOptimisticMessage(
  messages: readonly SyncChatMessage[],
  clientTempId: string,
  saved: SyncChatMessage,
): SyncChatMessage[] {
  const reconciled: SyncChatMessage = {
    ...saved,
    client_temp_id: saved.client_temp_id ?? clientTempId,
    send_status: mapDeliveryToSendStatus(saved.delivery_status) ?? "sent",
  };
  const index = messages.findIndex(
    (message) =>
      message.client_temp_id === clientTempId ||
      message.id === clientTempId ||
      messagesMatchForDedup(message, reconciled),
  );
  if (index === -1) return [...messages, reconciled];
  const next = [...messages];
  next[index] = reconciled;
  return next;
}

export function markOptimisticMessageFailed(
  messages: readonly SyncChatMessage[],
  clientTempId: string,
): SyncChatMessage[] {
  return messages.map((message) =>
    message.client_temp_id === clientTempId || message.id === clientTempId
      ? { ...message, send_status: "failed", delivery_status: "failed" }
      : message,
  );
}

export function appendMessageDeduped(
  messages: readonly SyncChatMessage[],
  incoming: SyncChatMessage,
): SyncChatMessage[] {
  if (shouldSkipRealtimeInsert(messages, incoming)) {
    return reconcileExistingRealtime(messages, incoming);
  }
  return [...messages, incoming];
}

function reconcileExistingRealtime(
  messages: readonly SyncChatMessage[],
  incoming: SyncChatMessage,
): SyncChatMessage[] {
  const index = messages.findIndex((message) => messagesMatchForDedup(message, incoming));
  if (index === -1) return [...messages];
  const next = [...messages];
  next[index] = {
    ...incoming,
    send_status: mapDeliveryToSendStatus(incoming.delivery_status) ?? "sent",
  };
  return next;
}

export function mergePolledMessages(
  current: readonly SyncChatMessage[],
  polled: readonly SyncChatMessage[],
): SyncChatMessage[] {
  const byId = new Map<string, SyncChatMessage>();
  for (const message of polled) byId.set(message.id, message);

  for (const message of current) {
    const pending =
      message.send_status === "sending" ||
      message.delivery_status === "pending" ||
      isOptimisticMessageId(message.id);
    if (!pending) continue;
    const tempId = message.client_temp_id ?? message.id;
    const replaced = polled.find(
      (row) =>
        row.client_temp_id === tempId ||
        row.id === tempId ||
        messagesMatchForDedup(row, message),
    );
    if (!replaced) byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export function mapDeliveryToSendStatus(
  deliveryStatus: string | null | undefined,
): MessageSendStatus | null {
  if (deliveryStatus === "pending") return "sending";
  if (deliveryStatus === "failed") return "failed";
  if (deliveryStatus === "sent") return "sent";
  if (deliveryStatus === "delivered") return "delivered";
  if (deliveryStatus === "read") return "read";
  return null;
}
