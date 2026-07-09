import type {
  ActiveOfferCreatedVia,
  ActiveOfferDisposition,
  ActiveOfferDistributionMode,
  ActiveOfferFilterInput,
  ActiveOfferFilterSnapshot,
  ActiveOfferProgressStats,
} from "@/lib/active-offers-types";
import type { ClientLead } from "@/lib/dashboard-data";

export type ActiveOfferSummary = {
  id: string;
  title: string;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdVia: ActiveOfferCreatedVia;
  filterSnapshot: ActiveOfferFilterSnapshot | null;
  distributionMode: ActiveOfferDistributionMode;
  archivedAt: string | null;
  leadCount: number;
  progress: ActiveOfferProgressStats | null;
};

export type ActiveOfferLeadItem = ClientLead & {
  daysSinceContact?: number | null;
  progress: {
    disposition: ActiveOfferDisposition | string;
    attemptCount: number;
    lastAttemptAt: string | null;
    assignedEmployeeId: string | null;
    notes: string | null;
    daysSinceContact: number | null;
  };
};

export type ActiveOfferDetail = ActiveOfferSummary & {
  assigneeIds: string[];
  leads: ActiveOfferLeadItem[];
  sellerProgress: ActiveOfferProgressStats | null;
};

export type ActiveOfferPreviewResult = {
  matchCount: number;
  cappedCount: number;
  sampleLeads: Array<ClientLead & { daysSinceContact: number | null }>;
};

export type CreateActiveOfferPayload = {
  title: string;
  filter: ActiveOfferFilterInput;
  assigneeEmployeeIds: string[];
  distributionMode: ActiveOfferDistributionMode;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Erro ${res.status}`);
  return data;
}

export async function fetchActiveOffersFromApi(): Promise<ActiveOfferSummary[]> {
  const res = await fetch("/api/client/crm/active-offers", { cache: "no-store" });
  const data = await parseJson<{ offers?: ActiveOfferSummary[] }>(res);
  return Array.isArray(data.offers) ? data.offers : [];
}

export async function fetchActiveOfferDetailFromApi(
  id: string,
  options?: { sellerQueueOnly?: boolean },
): Promise<ActiveOfferDetail> {
  const qs = options?.sellerQueueOnly ? "?queue=1" : "";
  const res = await fetch(`/api/client/crm/active-offers/${encodeURIComponent(id)}${qs}`, { cache: "no-store" });
  const data = await parseJson<{ offer?: ActiveOfferDetail }>(res);
  if (!data.offer) throw new Error("Lista de ligação não encontrada.");
  return data.offer;
}

export async function previewActiveOfferFromApi(filter: ActiveOfferFilterInput): Promise<ActiveOfferPreviewResult> {
  const res = await fetch("/api/client/crm/active-offers/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter }),
  });
  return parseJson<ActiveOfferPreviewResult>(res);
}

export async function createActiveOfferFromApi(payload: CreateActiveOfferPayload): Promise<ActiveOfferSummary> {
  const res = await fetch("/api/client/crm/active-offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ offer?: ActiveOfferSummary }>(res);
  if (!data.offer) throw new Error("Erro ao criar lista.");
  return data.offer;
}

export async function archiveActiveOfferFromApi(id: string): Promise<void> {
  const res = await fetch(`/api/client/crm/active-offers/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
  await parseJson<{ ok?: boolean }>(res);
}

export async function applyLeadDispositionFromApi(params: {
  offerId: string;
  leadId: string;
  disposition: ActiveOfferDisposition;
  notes?: string;
}): Promise<void> {
  const res = await fetch(
    `/api/client/crm/active-offers/${encodeURIComponent(params.offerId)}/leads/${encodeURIComponent(params.leadId)}/disposition`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposition: params.disposition, notes: params.notes }),
    },
  );
  await parseJson<{ ok?: boolean }>(res);
}

export async function fetchOfferProgressBySellerFromApi(
  offerId: string,
): Promise<Array<{ employeeId: string; stats: ActiveOfferProgressStats }>> {
  const res = await fetch(`/api/client/crm/active-offers/${encodeURIComponent(offerId)}/progress-by-seller`, {
    cache: "no-store",
  });
  const data = await parseJson<{ rows?: Array<{ employeeId: string; stats: ActiveOfferProgressStats }> }>(res);
  return Array.isArray(data.rows) ? data.rows : [];
}
