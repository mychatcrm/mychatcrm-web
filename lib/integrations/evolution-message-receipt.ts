export type CustomerDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type EvolutionSendReceipt = {
  messageId: string | null;
  remoteJid: string | null;
  providerStatus: string | null;
  deliveryStatus: CustomerDeliveryStatus;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringAt(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) current = record(current)?.[key];
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return null;
}

export function normalizeEvolutionProviderStatus(status: unknown): string | null {
  if (typeof status === "number" && Number.isFinite(status)) return String(status);
  if (typeof status === "string" && status.trim()) return status.trim().toUpperCase();
  return null;
}

export function mapEvolutionDeliveryStatus(status: unknown): CustomerDeliveryStatus {
  if (typeof status === "number") {
    if (status <= 0) return "failed";
    if (status >= 4) return "read";
    if (status === 3) return "delivered";
    if (status === 2) return "sent";
    return "pending";
  }
  if (typeof status === "string") {
    const normalized = status.trim().toUpperCase();
    if (normalized === "ERROR" || normalized === "FAILED") return "failed";
    if (normalized === "READ" || normalized === "PLAYED") return "read";
    if (normalized === "DELIVERY_ACK") return "delivered";
    if (normalized === "SERVER_ACK") return "sent";
  }
  return "pending";
}

export function extractEvolutionSendReceipt(payload: unknown): EvolutionSendReceipt {
  const root = record(payload);
  const status =
    root?.status ??
    record(root?.key)?.status ??
    record(root?.data)?.status ??
    record(record(root?.data)?.key)?.status ??
    null;

  return {
    messageId: stringAt(payload, [
      ["key", "id"],
      ["message", "key", "id"],
      ["data", "key", "id"],
      ["data", "id"],
      ["id"],
    ]),
    remoteJid: stringAt(payload, [
      ["key", "remoteJid"],
      ["message", "key", "remoteJid"],
      ["data", "key", "remoteJid"],
      ["data", "remoteJid"],
      ["remoteJid"],
    ]),
    providerStatus: normalizeEvolutionProviderStatus(status),
    deliveryStatus: mapEvolutionDeliveryStatus(status),
  };
}

const DELIVERY_RANK: Record<CustomerDeliveryStatus, number> = {
  failed: -1,
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function shouldApplyCustomerDeliveryStatus(
  current: string | null | undefined,
  next: CustomerDeliveryStatus,
): boolean {
  const currentStatus =
    current === "pending" || current === "sent" || current === "delivered" || current === "read" || current === "failed"
      ? current
      : "pending";
  if (next === "failed") return currentStatus === "pending" || currentStatus === "sent";
  if (currentStatus === "failed") return next !== "pending";
  return DELIVERY_RANK[next] >= DELIVERY_RANK[currentStatus];
}
