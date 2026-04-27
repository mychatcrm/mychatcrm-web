import type { ClientLead } from "@/lib/dashboard-data";

export const CRM_LEADS_UPDATED_EVENT = "mychatcrm-crm-leads-updated";

export function crmLeadsStorageKey(tenantId: string) {
  return `mychatcrm.crm.leads.${tenantId}`;
}

function isLeadArray(v: unknown): v is ClientLead[] {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && typeof (x as ClientLead).id === "string");
}

export function loadCrmLeadsSnapshot(tenantId: string, fallback: ClientLead[]): ClientLead[] {
  if (typeof window === "undefined") return fallback.map((l) => ({ ...l }));
  try {
    const raw = window.localStorage.getItem(crmLeadsStorageKey(tenantId));
    if (!raw) return fallback.map((l) => ({ ...l }));
    const parsed = JSON.parse(raw) as unknown;
    if (!isLeadArray(parsed) || parsed.length === 0) return fallback.map((l) => ({ ...l }));
    return parsed.map((l) => ({ ...l }));
  } catch {
    return fallback.map((l) => ({ ...l }));
  }
}

export function persistCrmLeadsSnapshot(tenantId: string, leads: ClientLead[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(crmLeadsStorageKey(tenantId), JSON.stringify(leads));
    window.dispatchEvent(new Event(CRM_LEADS_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}
