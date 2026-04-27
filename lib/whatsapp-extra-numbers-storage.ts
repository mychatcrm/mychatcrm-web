export const WHATSAPP_EXTRAS_UPDATED_EVENT = "mychatcrm-wa-extras-updated";

const STORAGE_KEY = "mychatcrm.wa.extras.v2.";

const MAX_SLOTS_PER_PURCHASE = 20;

export type WhatsAppExtraPurchase = {
  id: string;
  quantity: number;
  at: string;
};

export type WhatsAppExtraSlotsState = {
  version: 2;
  /** Linhas extra pagas (contrato); ligação do número em Integrações. */
  purchasedSlots: number;
  /** Quantas linhas extra o utilizador marcou como configuradas (demo, nesta página). */
  configuredSlots: number;
  purchases: WhatsAppExtraPurchase[];
};

type LegacyPhoneRow = {
  id: string;
  phoneDigits: string;
  display: string;
  activatedAt: string;
};

function sanitizeTenantId(tenantId: string) {
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tenant";
}

export function whatsappExtraSlotsStorageKey(tenantId: string) {
  return `${STORAGE_KEY}${sanitizeTenantId(tenantId)}`;
}

function storageKey(tenantId: string) {
  return whatsappExtraSlotsStorageKey(tenantId);
}

function defaultState(): WhatsAppExtraSlotsState {
  return { version: 2, purchasedSlots: 0, configuredSlots: 0, purchases: [] };
}

function parseLegacyPhoneArray(raw: unknown): LegacyPhoneRow[] {
  if (!Array.isArray(raw)) return [];
  const out: LegacyPhoneRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.phoneDigits === "string" && o.phoneDigits) {
      out.push(row as LegacyPhoneRow);
    }
  }
  return out;
}

function readRaw(tenantId: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeState(raw: unknown): WhatsAppExtraSlotsState {
  if (raw == null) return defaultState();
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.version === 2 && typeof o.purchasedSlots === "number") {
      const purchasedSlots = Math.max(0, Math.floor(o.purchasedSlots));
      const rawConfigured =
        typeof o.configuredSlots === "number" ? Math.max(0, Math.floor(o.configuredSlots)) : 0;
      const configuredSlots = Math.min(purchasedSlots, rawConfigured);
      const purchases = Array.isArray(o.purchases)
        ? (o.purchases as unknown[]).flatMap((p) => {
            if (!p || typeof p !== "object") return [];
            const r = p as Record<string, unknown>;
            const id = typeof r.id === "string" ? r.id : "";
            const quantity = typeof r.quantity === "number" ? Math.max(1, Math.floor(r.quantity)) : 0;
            const at = typeof r.at === "string" ? r.at : "";
            if (!id || !quantity || !at) return [];
            return [{ id, quantity, at } satisfies WhatsAppExtraPurchase];
          })
        : [];
      return { version: 2, purchasedSlots, configuredSlots, purchases };
    }
  }
  const legacy = parseLegacyPhoneArray(raw);
  if (legacy.length > 0) {
    return {
      version: 2,
      purchasedSlots: legacy.length,
      configuredSlots: legacy.length,
      purchases: [],
    };
  }
  return defaultState();
}

export function readWhatsAppExtraSlotsState(tenantId: string): WhatsAppExtraSlotsState {
  if (typeof window === "undefined") return defaultState();
  return normalizeState(readRaw(tenantId));
}

export function readExtraSlotsSummary(tenantId: string): { purchased: number; configured: number } {
  const s = readWhatsAppExtraSlotsState(tenantId);
  return { purchased: s.purchasedSlots, configured: s.configuredSlots };
}

function persist(tenantId: string, state: WhatsAppExtraSlotsState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(state));
    window.dispatchEvent(new Event(WHATSAPP_EXTRAS_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeExtraWhatsAppNumbers(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const fn = () => onChange();
  window.addEventListener(WHATSAPP_EXTRAS_UPDATED_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(WHATSAPP_EXTRAS_UPDATED_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

export function addPurchasedWhatsAppSlots(tenantId: string, quantity: number): WhatsAppExtraSlotsState {
  const q = Math.max(1, Math.min(MAX_SLOTS_PER_PURCHASE, Math.floor(quantity)));
  const prev = readWhatsAppExtraSlotsState(tenantId);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `wa-p-${Date.now()}`;
  const next: WhatsAppExtraSlotsState = {
    version: 2,
    purchasedSlots: prev.purchasedSlots + q,
    /** Mantém o que já estava configurado; as novas linhas ficam pendentes até Integrações. */
    configuredSlots: prev.configuredSlots,
    purchases: [...prev.purchases, { id, quantity: q, at: new Date().toISOString() }],
  };
  persist(tenantId, next);
  return next;
}

/** Demo: regista que uma linha extra foi configurada em Integrações (não ultrapassa `purchasedSlots`). */
export function incrementConfiguredExtraSlots(tenantId: string): WhatsAppExtraSlotsState {
  const prev = readWhatsAppExtraSlotsState(tenantId);
  if (prev.configuredSlots >= prev.purchasedSlots) return prev;
  const next: WhatsAppExtraSlotsState = {
    ...prev,
    configuredSlots: Math.min(prev.purchasedSlots, prev.configuredSlots + 1),
  };
  persist(tenantId, next);
  return next;
}

/**
 * Alinha `configuredSlots` com o que está realmente ligado em Integrações: cada linha extra (índice ≥ 1)
 * com método QR ou Meta conta como configurada (até o máximo contratado).
 */
export function updateConfiguredExtrasFromSlotMethods(
  tenantId: string,
  slots: ReadonlyArray<"qr" | "meta" | null | undefined>,
): WhatsAppExtraSlotsState {
  const prev = readWhatsAppExtraSlotsState(tenantId);
  if (prev.purchasedSlots <= 0) {
    if (prev.configuredSlots === 0) return prev;
    const next: WhatsAppExtraSlotsState = { ...prev, configuredSlots: 0 };
    persist(tenantId, next);
    return next;
  }
  let n = 0;
  for (let i = 1; i <= prev.purchasedSlots && i < slots.length; i++) {
    const m = slots[i];
    if (m === "qr" || m === "meta") n += 1;
  }
  n = Math.min(prev.purchasedSlots, n);
  if (n === prev.configuredSlots) return prev;
  const next: WhatsAppExtraSlotsState = { ...prev, configuredSlots: n };
  persist(tenantId, next);
  return next;
}
