import type { ClientLead } from "@/lib/dashboard-data";
import { createClient } from "@supabase/supabase-js";

export const CRM_LEADS_UPDATED_EVENT = "mychatcrm-crm-leads-updated";

/** v2: ignora snapshots antigos com leads de demonstração. */
export function crmLeadsStorageKey(tenantId: string) {
  return `mychatcrm.crm.leads.v2.${tenantId}`;
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

async function parseLeadsResponse(res: Response): Promise<ClientLead[]> {
  if (!res.ok) throw new Error(`CRM leads API ${res.status}`);
  const data = (await res.json()) as { leads?: ClientLead[]; lead?: ClientLead };
  if (Array.isArray(data.leads)) return data.leads;
  if (data.lead) return [data.lead];
  return [];
}

export async function fetchCrmLeadsFromApi(): Promise<ClientLead[]> {
  const res = await fetch("/api/client/crm/leads", { cache: "no-store" });
  return parseLeadsResponse(res);
}

export async function createCrmLeadInApi(lead: ClientLead): Promise<ClientLead> {
  const res = await fetch("/api/client/crm/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead),
  });
  const [created] = await parseLeadsResponse(res);
  return created ?? lead;
}

export async function updateCrmLeadInApi(leadId: string, patch: Partial<ClientLead> & Record<string, unknown>): Promise<ClientLead | null> {
  const res = await fetch(`/api/client/crm/leads/${encodeURIComponent(leadId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let message = `CRM leads PUT ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const [updated] = await parseLeadsResponse(res);
  return updated ?? null;
}

export async function moveCrmLeadCardInApi(params: {
  leadId: string;
  funilId: string;
  status: string;
  previousLeadId: string | null;
  nextLeadId: string | null;
}): Promise<{ id: string; funilId: string; status: string; crmPosition: number }> {
  const res = await fetch("/api/client/crm/leads/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `CRM lead move ${res.status}`);
  }
  const data = (await res.json()) as {
    lead: { id: string; funilId: string; status: string; crmPosition: number };
  };
  return data.lead;
}

export async function deleteCrmLeadInApi(leadId: string): Promise<void> {
  const res = await fetch(`/api/client/crm/leads/${encodeURIComponent(leadId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`CRM leads DELETE ${res.status}`);
}

export async function deleteCrmLeadsInApi(leadIds: string[]): Promise<{ ids: string[]; count: number }> {
  const res = await fetch("/api/client/crm/leads", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: leadIds }),
  });
  if (!res.ok) throw new Error(`CRM leads bulk DELETE ${res.status}`);
  const data = (await res.json()) as { ids?: string[]; count?: number };
  return {
    ids: Array.isArray(data.ids) ? data.ids : [],
    count: typeof data.count === "number" ? data.count : 0,
  };
}

export type CrmBulkAction =
  | "assign_attendant"
  | "change_status"
  | "convert_to_active_offer"
  | "delete";

export type CrmBulkActionResponse = {
  ok: boolean;
  action: CrmBulkAction;
  requestedCount: number;
  affectedCount: number;
  deletedIds?: string[];
  offer?: {
    id: string;
    title: string;
    status: string;
    createdAt: string | null;
    leadCount: number;
  };
};

export async function runCrmLeadBulkActionInApi(params: {
  action: CrmBulkAction;
  leadIds: string[];
  payload?: Record<string, unknown>;
}): Promise<CrmBulkActionResponse> {
  const res = await fetch("/api/client/crm/leads/bulk-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `CRM bulk action ${res.status}`);
  }
  return (await res.json()) as CrmBulkActionResponse;
}

export async function loadCrmLeadsFromApiWithLocalMigration(
  tenantId: string,
  fallback: ClientLead[],
): Promise<ClientLead[]> {
  const remote = await fetchCrmLeadsFromApi();
  if (remote.length > 0) {
    persistCrmLeadsSnapshot(tenantId, remote);
    return remote;
  }

  const local = loadCrmLeadsSnapshot(tenantId, fallback);
  if (local.length === 0) {
    persistCrmLeadsSnapshot(tenantId, []);
    return [];
  }

  const migrated = await Promise.all(local.map((lead) => createCrmLeadInApi(lead)));
  const clean = migrated.filter((lead): lead is ClientLead => Boolean(lead));
  persistCrmLeadsSnapshot(tenantId, clean);
  return clean;
}

let supabaseBrowser: ReturnType<typeof createClient> | null = null;

function getSupabaseBrowser() {
  if (!supabaseBrowser) {
    supabaseBrowser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return supabaseBrowser;
}

export function subscribeToCrmLeadsRealtime(
  tenantId: string,
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const supabase = getSupabaseBrowser();
  const channel = supabase
    .channel(`crm-leads-${tenantId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "leads",
        filter: `tenant_id=eq.${tenantId}`,
      },
      () => onChange(),
    )
    .subscribe();

  const intervalId = setInterval(() => onChange(), 10_000);

  return () => {
    clearInterval(intervalId);
    void supabase.removeChannel(channel);
  };
}
