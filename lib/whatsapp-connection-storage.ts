import {
  readWhatsAppExtraSlotsState,
  updateConfiguredExtrasFromSlotMethods,
} from "@/lib/whatsapp-extra-numbers-storage";

const LEGACY_STORE_VERSION = 1 as const;
const MULTI_STORE_VERSION = 2 as const;

export const WHATSAPP_CONNECTION_UPDATED_EVENT = "mychatcrm-whatsapp-connection-updated";

export type WhatsAppConnectionChoice = "qr" | "meta";

export type WhatsAppConnectionsFileV2 = {
  version: 2;
  slots: Array<WhatsAppConnectionChoice | null>;
};

function sanitizeTenantId(tenantId: string) {
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tenant";
}

/** Chave legada (uma escolha global); ainda escutada para migração e abas antigas. */
export function whatsappConnectionStorageKey(tenantId: string) {
  return `mychatcrm.whatsapp.connection.v${LEGACY_STORE_VERSION}.${sanitizeTenantId(tenantId)}`;
}

/** Estado actual: uma entrada por linha WhatsApp contratada (1 do plano + extras). */
export function whatsappConnectionsStateStorageKey(tenantId: string) {
  return `mychatcrm.whatsapp.connections.v${MULTI_STORE_VERSION}.${sanitizeTenantId(tenantId)}`;
}

export function totalWhatsAppLinesForTenant(tenantId: string): number {
  const extras = readWhatsAppExtraSlotsState(tenantId).purchasedSlots;
  return 1 + Math.max(0, extras);
}

function readLegacyChoice(tenantId: string): WhatsAppConnectionChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(whatsappConnectionStorageKey(tenantId));
    if (raw !== "qr" && raw !== "meta") return null;
    return raw;
  } catch {
    return null;
  }
}

function readV2Raw(tenantId: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(whatsappConnectionsStateStorageKey(tenantId));
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeV2(raw: unknown, total: number): WhatsAppConnectionsFileV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 2 || !Array.isArray(o.slots)) return null;
  const slots: Array<WhatsAppConnectionChoice | null> = [];
  for (let i = 0; i < total; i++) {
    const v = o.slots[i];
    slots[i] = v === "qr" || v === "meta" ? v : null;
  }
  return { version: 2, slots };
}

/** Lê o método por linha (comprimento = linhas contratadas). Migra legado v1 → slot 0. */
export function readWhatsAppSlotMethods(tenantId: string): (WhatsAppConnectionChoice | null)[] {
  const total = totalWhatsAppLinesForTenant(tenantId);
  const empty = () => Array.from({ length: total }, () => null as WhatsAppConnectionChoice | null);

  if (typeof window === "undefined") return empty();

  const v2 = normalizeV2(readV2Raw(tenantId), total);
  if (v2) return v2.slots;

  const slots = empty();
  const legacy = readLegacyChoice(tenantId);
  if (legacy) slots[0] = legacy;
  return slots;
}

function persistSlots(tenantId: string, slots: (WhatsAppConnectionChoice | null)[]) {
  if (typeof window === "undefined") return;
  const total = totalWhatsAppLinesForTenant(tenantId);
  const nextSlots = slots.slice(0, total);
  while (nextSlots.length < total) nextSlots.push(null);
  try {
    const payload: WhatsAppConnectionsFileV2 = { version: 2, slots: nextSlots };
    window.localStorage.setItem(whatsappConnectionsStateStorageKey(tenantId), JSON.stringify(payload));
    try {
      window.localStorage.removeItem(whatsappConnectionStorageKey(tenantId));
    } catch {
      /* ignore */
    }
    updateConfiguredExtrasFromSlotMethods(tenantId, nextSlots);
    window.dispatchEvent(new Event(WHATSAPP_CONNECTION_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Define o método (QR ou Meta) de uma linha; `null` desliga essa linha. Só uma opção por linha. */
export function setWhatsAppSlotMethod(
  tenantId: string,
  slotIndex: number,
  method: WhatsAppConnectionChoice | null,
): void {
  const total = totalWhatsAppLinesForTenant(tenantId);
  if (slotIndex < 0 || slotIndex >= total) return;
  const slots = readWhatsAppSlotMethods(tenantId);
  const next = [...slots];
  while (next.length < total) next.push(null);
  next[slotIndex] = method;
  persistSlots(tenantId, next);
}

/** @deprecated Prefer `readWhatsAppSlotMethods`; mantido para código legado — devolve o método da linha 0 se existir. */
export function loadWhatsAppConnectionChoice(tenantId: string): WhatsAppConnectionChoice | null {
  const slots = readWhatsAppSlotMethods(tenantId);
  return slots[0] ?? null;
}

/**
 * @deprecated Prefer `setWhatsAppSlotMethod`; gravava uma única escolha global na linha 0.
 */
export function saveWhatsAppConnectionChoice(tenantId: string, choice: WhatsAppConnectionChoice | null) {
  setWhatsAppSlotMethod(tenantId, 0, choice);
}

export function whatsappConnectionWatchableStorageKeys(tenantId: string): string[] {
  return [whatsappConnectionsStateStorageKey(tenantId), whatsappConnectionStorageKey(tenantId)];
}
