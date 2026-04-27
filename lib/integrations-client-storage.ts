import type { IntegrationSlug } from "@/lib/integrations-catalog";
import { LOCAL_INTEGRATION_SLUGS } from "@/lib/integrations-catalog";

export const INTEGRATIONS_CLIENT_UPDATED_EVENT = "mychatcrm-integrations-client-updated";

const STORE_VERSION = 1 as const;
const MAX_HINT = 120;

const localSlugSet = new Set<IntegrationSlug>(LOCAL_INTEGRATION_SLUGS);

function sanitizeTenantId(tenantId: string) {
  const t = tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return t || "tenant";
}

function storageKey(tenantId: string) {
  return `mychatcrm.integrations.client.v${STORE_VERSION}.${sanitizeTenantId(tenantId)}`;
}

export type ClientIntegrationEntry = {
  connected: boolean;
  updatedAt?: string;
  /** Apresentacao; nunca guardar segredos completos aqui. */
  accountHint?: string;
};

export type ClientIntegrationsStore = {
  v: typeof STORE_VERSION;
  bySlug: Partial<Record<IntegrationSlug, ClientIntegrationEntry>>;
};

function emptyStore(): ClientIntegrationsStore {
  return { v: STORE_VERSION, bySlug: {} };
}

function normalizeEntry(data: unknown): ClientIntegrationEntry {
  if (!data || typeof data !== "object") return { connected: false };
  const o = data as Record<string, unknown>;
  const updatedAt =
    typeof o.updatedAt === "string" && !Number.isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : undefined;
  if (o.connected !== true) return { connected: false, updatedAt };
  const hintRaw = typeof o.accountHint === "string" ? o.accountHint.trim().slice(0, MAX_HINT) : "";
  return {
    connected: true,
    updatedAt,
    accountHint: hintRaw || undefined,
  };
}

function normalizeStore(data: unknown): ClientIntegrationsStore {
  if (!data || typeof data !== "object") return emptyStore();
  const o = data as Record<string, unknown>;
  if (o.v !== STORE_VERSION || typeof o.bySlug !== "object" || !o.bySlug) return emptyStore();
  const bySlug: ClientIntegrationsStore["bySlug"] = {};
  const raw = o.bySlug as Record<string, unknown>;
  for (const slug of LOCAL_INTEGRATION_SLUGS) {
    if (raw[slug] !== undefined) {
      bySlug[slug] = normalizeEntry(raw[slug]);
    }
  }
  return { v: STORE_VERSION, bySlug };
}

export function loadClientIntegrations(tenantId: string): ClientIntegrationsStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId));
    if (!raw) return emptyStore();
    return normalizeStore(JSON.parse(raw) as unknown);
  } catch {
    return emptyStore();
  }
}

export function persistClientIntegrations(tenantId: string, store: ClientIntegrationsStore) {
  if (typeof window === "undefined") return;
  try {
    const clean = normalizeStore(store);
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(clean));
    window.dispatchEvent(new Event(INTEGRATIONS_CLIENT_UPDATED_EVENT));
  } catch {
    /* quota / private mode */
  }
}

export function patchClientIntegration(
  tenantId: string,
  slug: IntegrationSlug,
  patch: Partial<Pick<ClientIntegrationEntry, "connected" | "accountHint">>,
) {
  if (!localSlugSet.has(slug)) return;
  const prev = loadClientIntegrations(tenantId);
  const cur = normalizeEntry(prev.bySlug[slug]);
  const hint =
    patch.accountHint !== undefined ? patch.accountHint.trim().slice(0, MAX_HINT) || undefined : cur.accountHint;
  const connected = patch.connected !== undefined ? Boolean(patch.connected) : cur.connected;
  const next: ClientIntegrationsStore = {
    ...prev,
    bySlug: {
      ...prev.bySlug,
      [slug]: {
        connected,
        accountHint: hint,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  persistClientIntegrations(tenantId, next);
}

export function clientIntegrationsStorageKey(tenantId: string) {
  return storageKey(tenantId);
}
