import type { ClientLead } from "@/lib/dashboard-data";

export type ActiveOfferSummary = {
  id: string;
  title: string;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  leadCount: number;
};

export type ActiveOfferDetail = ActiveOfferSummary & {
  leads: ClientLead[];
};

export async function fetchActiveOffersFromApi(): Promise<ActiveOfferSummary[]> {
  const res = await fetch("/api/client/crm/active-offers", { cache: "no-store" });
  if (!res.ok) throw new Error(`Active offers API ${res.status}`);
  const data = (await res.json()) as { offers?: ActiveOfferSummary[] };
  return Array.isArray(data.offers) ? data.offers : [];
}

export async function fetchActiveOfferDetailFromApi(id: string): Promise<ActiveOfferDetail> {
  const res = await fetch(`/api/client/crm/active-offers/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Active offer detail API ${res.status}`);
  const data = (await res.json()) as { offer?: ActiveOfferDetail };
  if (!data.offer) throw new Error("Oferta ativa não encontrada.");
  return data.offer;
}
