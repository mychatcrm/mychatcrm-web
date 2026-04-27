const STORE_VERSION = 1 as const;

/** Disparado quando a ligação a páginas Facebook (demo) muda — alinhar com `LeadDistributionHub` e `IntegracoesHub`. */
export const FACEBOOK_PAGES_CONNECTION_UPDATED_EVENT = "mychatcrm-facebook-pages-connection-updated";

export type FacebookPagesConnectionState = {
  connected: boolean;
  /** Nome da página ou nota (demo; sem segredos). */
  accountHint?: string;
  updatedAt?: string;
};

function sanitizeTenantId(tenantId: string) {
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tenant";
}

function storageKey(tenantId: string) {
  return `mychatcrm.facebook.pages.v${STORE_VERSION}.${sanitizeTenantId(tenantId)}`;
}

function normalize(raw: unknown): FacebookPagesConnectionState {
  if (!raw || typeof raw !== "object") return { connected: false };
  const o = raw as Record<string, unknown>;
  const connected = o.connected === true;
  const hint = typeof o.accountHint === "string" ? o.accountHint.trim().slice(0, 120) : "";
  const updatedAt = typeof o.updatedAt === "string" && !Number.isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : undefined;
  return {
    connected,
    accountHint: hint || undefined,
    updatedAt,
  };
}

export function loadFacebookPagesConnection(tenantId: string): FacebookPagesConnectionState {
  if (typeof window === "undefined") return { connected: false };
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) return { connected: false };
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return { connected: false };
  }
}

export function persistFacebookPagesConnection(tenantId: string, next: FacebookPagesConnectionState) {
  if (typeof window === "undefined") return;
  try {
    const payload: FacebookPagesConnectionState = {
      connected: Boolean(next.connected),
      accountHint: next.accountHint?.trim().slice(0, 120) || undefined,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(payload));
    window.dispatchEvent(new Event(FACEBOOK_PAGES_CONNECTION_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function facebookPagesStorageKey(tenantId: string) {
  return storageKey(tenantId);
}
