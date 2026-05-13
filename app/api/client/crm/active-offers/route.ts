import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ActiveOfferRow = {
  id: string;
  title: string | null;
  status: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toOfferSummary(row: ActiveOfferRow, leadCount: number) {
  return {
    id: row.id,
    title: row.title?.trim() || "Oferta ativa",
    status: row.status?.trim() || "active",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leadCount,
  };
}

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data: offers, error } = await sb
    .from("active_offers")
    .select("id, title, status, created_by, created_at, updated_at")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/client/crm/active-offers] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar ofertas ativas." }, { status: 503 });
  }

  const offerRows = (offers ?? []) as ActiveOfferRow[];
  const offerIds = offerRows.map((offer) => offer.id);
  const countsByOffer = new Map<string, number>();

  if (offerIds.length) {
    const { data: links, error: linksError } = await sb
      .from("active_offer_leads")
      .select("active_offer_id")
      .eq("tenant_id", session.tenantId)
      .in("active_offer_id", offerIds);

    if (linksError) {
      console.error("[api/client/crm/active-offers] links", linksError.code, linksError.message);
      return NextResponse.json({ error: "Erro ao carregar vínculos das ofertas." }, { status: 503 });
    }

    for (const link of links ?? []) {
      const id = (link as { active_offer_id?: unknown }).active_offer_id;
      if (typeof id === "string") countsByOffer.set(id, (countsByOffer.get(id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    offers: offerRows.map((offer) => toOfferSummary(offer, countsByOffer.get(offer.id) ?? 0)),
  });
}
