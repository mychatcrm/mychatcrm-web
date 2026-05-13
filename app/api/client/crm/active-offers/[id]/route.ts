import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import type { ClientLead } from "@/lib/dashboard-data";
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

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  agent_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  crm_funnel_id?: string | null;
  owner_employee_id?: string | null;
};

function toDateISO(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function sourceLabel(source: string | null | undefined): string {
  const clean = source?.trim().toLowerCase() ?? "";
  if (clean === "whatsapp") return "WhatsApp";
  if (clean.includes("facebook") || clean.includes("meta") || clean.includes("form")) return "Meta / Facebook";
  return "Entrada manual";
}

function rowToClientLead(row: LeadRow): ClientLead {
  const agent = row.agent_id?.trim() || "Agente padrão · CRM";
  const origem = sourceLabel(row.source);
  return {
    id: row.id,
    funilId: row.crm_funnel_id?.trim() || "funil-default",
    dataEntradaISO: toDateISO(row.created_at),
    nome: row.name?.trim() || row.phone?.trim() || "Lead sem nome",
    empresa: "—",
    telefone: row.phone?.trim() || "—",
    email: row.email?.trim() || "—",
    valor: 0,
    status: row.status?.trim() || "novo",
    tag: origem === "WhatsApp" ? "WhatsApp" : "Novo",
    agenteEntrada: agent,
    agenteAtendendo: agent,
    responsavel: row.owner_employee_id?.trim() ? "Atendente" : "Equipe",
    ownerEmployeeId: row.owner_employee_id?.trim() || undefined,
    ultimoContato: "—",
    proximaAcao: row.notes?.trim() || "Qualificar interesse",
    origem,
    tags: origem === "WhatsApp" ? ["WhatsApp", "Novo"] : ["Novo"],
  };
}

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

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!params.id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data: offer, error: offerError } = await sb
    .from("active_offers")
    .select("id, title, status, created_by, created_at, updated_at")
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .single();

  if (offerError || !offer) {
    return NextResponse.json({ error: "Oferta ativa não encontrada." }, { status: 404 });
  }

  const { data: links, error: linksError } = await sb
    .from("active_offer_leads")
    .select("lead_id")
    .eq("tenant_id", session.tenantId)
    .eq("active_offer_id", params.id);

  if (linksError) {
    console.error("[api/client/crm/active-offers] detail links", linksError.code, linksError.message);
    return NextResponse.json({ error: "Erro ao carregar leads da oferta." }, { status: 503 });
  }

  const leadIds = (links ?? [])
    .map((link) => (link as { lead_id?: unknown }).lead_id)
    .filter((id): id is string => typeof id === "string");
  let leads: ClientLead[] = [];

  if (leadIds.length) {
    const { data: leadRows, error: leadsError } = await sb
      .from("leads")
      .select("id, name, phone, email, source, status, notes, agent_id, created_at, updated_at, crm_funnel_id, owner_employee_id")
      .eq("tenant_id", session.tenantId)
      .in("id", leadIds);
    if (leadsError) {
      console.error("[api/client/crm/active-offers] detail leads", leadsError.code, leadsError.message);
      return NextResponse.json({ error: "Erro ao carregar leads da oferta." }, { status: 503 });
    }
    leads = ((leadRows ?? []) as LeadRow[]).map(rowToClientLead);
  }

  return NextResponse.json({
    offer: {
      ...toOfferSummary(offer as ActiveOfferRow, leads.length),
      leads,
    },
  });
}
