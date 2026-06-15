import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  CommercialAuditEntry,
  CommercialCoupon,
  CommercialPartner,
  CommercialStore,
  CouponRedemption,
} from "@/lib/commercial/types";
import { buildSeedCommercialStore } from "@/lib/commercial/seed";

const DATA_DIR = path.join(process.cwd(), "data", "commercial");
const STORE_FILE = path.join(DATA_DIR, "store.json");

/** Cache curto só para leituras de dashboard admin (reduz I/O em disco). Invalidado em qualquer escrita. */
let metricsStoreCache: { value: CommercialStore; at: number } | null = null;
const METRICS_STORE_CACHE_MS = 4000;

export function invalidateCommercialStoreMetricsCache() {
  metricsStoreCache = null;
}

function isCoupon(row: unknown): row is CommercialCoupon {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.code === "string" && (r.discountType === "percent" || r.discountType === "fixed");
}

function isPartner(row: unknown): row is CommercialPartner {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" && typeof r.code === "string";
}

function isRedemption(row: unknown): row is CouponRedemption {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.idempotencyKey === "string" && typeof r.couponId === "string";
}

function normalizeStore(raw: unknown): CommercialStore {
  const seed = buildSeedCommercialStore();
  if (!raw || typeof raw !== "object") return seed;
  const o = raw as Record<string, unknown>;
  const coupons = Array.isArray(o.coupons) ? o.coupons.filter(isCoupon) : seed.coupons;
  const partners = Array.isArray(o.partners) ? o.partners.filter(isPartner) : seed.partners;
  const redemptions = Array.isArray(o.redemptions) ? o.redemptions.filter(isRedemption) : [];
  const auditLog = Array.isArray(o.auditLog) ? (o.auditLog as CommercialAuditEntry[]).filter((a) => a && typeof a.id === "string") : [];
  return { version: 1, coupons, partners, redemptions, extraCodes: [], auditLog };
}

export function readCommercialStore(): CommercialStore {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      const seed = buildSeedCommercialStore();
      writeCommercialStore(seed);
      return seed;
    }
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as unknown;
    return normalizeStore(raw);
  } catch {
    return buildSeedCommercialStore();
  }
}

/**
 * Snapshot do store com TTL curto — usar apenas em endpoints GET de métricas (não em mutações).
 */
export function readCommercialStoreForMetricsDashboard(): CommercialStore {
  const now = Date.now();
  if (metricsStoreCache && now - metricsStoreCache.at < METRICS_STORE_CACHE_MS) {
    return metricsStoreCache.value;
  }
  const value = readCommercialStore();
  metricsStoreCache = { value, at: now };
  return value;
}

export function writeCommercialStore(store: CommercialStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  invalidateCommercialStoreMetricsCache();
}

export function appendAudit(store: CommercialStore, entry: Omit<CommercialAuditEntry, "id" | "createdAt">) {
  const row: CommercialAuditEntry = {
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  const next = [...(store.auditLog ?? []), row].slice(-400);
  return { ...store, auditLog: next };
}
