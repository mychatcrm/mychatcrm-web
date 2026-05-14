type MessageLatencySource = "inbound" | "outbound" | "manual" | "ai";

function maskJid(remoteJid: string): string {
  const digits = remoteJid.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `****${digits.slice(-4)}`;
}

export function logMessageLatency(event: {
  phase: "received" | "saved" | "rendered";
  source: MessageLatencySource;
  tenantId: string;
  remoteJid: string;
  messageId?: string | null;
  at?: string;
}): void {
  if (process.env.NODE_ENV === "production" && event.phase !== "saved") return;
  console.info("[message-latency]", {
    phase: event.phase,
    source: event.source,
    tenant_id: event.tenantId,
    remote_jid: maskJid(event.remoteJid),
    message_id: event.messageId ?? null,
    at: event.at ?? new Date().toISOString(),
  });
}
