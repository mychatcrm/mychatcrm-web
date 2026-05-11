import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientLead } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  tenant_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  agent_id: string | null;
  last_seen: string | null;
  last_message_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toDateISO(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatRelativeContact(value: string | null | undefined): string {
  if (!value) return "Sem contato recente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem contato recente";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "Agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} d`;
}

function rowToClientLead(row: LeadRow): ClientLead {
  const source = row.source?.trim() || "manual";
  const agent = row.agent_id?.trim() || "Agente padrão · CRM";
  return {
    id: row.id,
    funilId: "funil-default",
    dataEntradaISO: toDateISO(row.created_at),
    nome: row.name?.trim() || row.phone?.trim() || "Lead sem nome",
    empresa: "—",
    telefone: row.phone?.trim() || "—",
    email: row.email?.trim() || "—",
    valor: 0,
    status: row.status?.trim() || "novo",
    tag: source === "whatsapp" ? "WhatsApp" : "Novo",
    agenteEntrada: agent,
    agenteAtendendo: agent,
    responsavel: "Equipe",
    ultimoContato: formatRelativeContact(row.last_message_at ?? row.last_seen ?? row.updated_at ?? row.created_at),
    proximaAcao: row.notes?.trim() || "Qualificar interesse",
    origem: source === "whatsapp" ? "WhatsApp" : "Entrada manual",
    tags: source === "whatsapp" ? ["WhatsApp", "Novo"] : ["Novo", "Manual"],
  };
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean === "—") return null;
  return clean;
}

function uuidOrUndefined(value: unknown): string | undefined {
  const clean = textOrNull(value);
  if (!clean) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)
    ? clean
    : undefined;
}

function leadPayloadToInsert(body: Record<string, unknown>, tenantId: string) {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    name: textOrNull(body.name) ?? textOrNull(body.nome),
    phone: textOrNull(body.phone) ?? textOrNull(body.telefone),
    email: textOrNull(body.email),
    source: textOrNull(body.source) ?? textOrNull(body.origem) ?? "manual",
    status: textOrNull(body.status) ?? "novo",
    notes: textOrNull(body.notes) ?? textOrNull(body.proximaAcao),
    agent_id: textOrNull(body.agent_id) ?? textOrNull(body.agenteAtendendo) ?? textOrNull(body.agenteEntrada),
    created_at: textOrNull(body.created_at) ?? textOrNull(body.dataEntradaISO) ?? now,
    updated_at: now,
  };
  const id = uuidOrUndefined(body.id);
  if (id) payload.id = id;
  return payload;
}

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .select("id, tenant_id, name, phone, email, source, status, notes, agent_id, last_seen, last_message_at, created_at, updated_at")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/client/crm/leads] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar leads." }, { status: 503 });
  }

  return NextResponse.json(
    { leads: (data ?? []).map((row) => rowToClientLead(row as LeadRow)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const payload = leadPayloadToInsert(body, session.tenantId);
  if (!payload.name && !payload.phone && !payload.email) {
    return NextResponse.json({ error: "Informe ao menos nome, telefone ou e-mail." }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .insert(payload)
    .select("id, tenant_id, name, phone, email, source, status, notes, agent_id, last_seen, last_message_at, created_at, updated_at")
    .single();

  if (error) {
    console.error("[api/client/crm/leads] POST", error.code, error.message);
    return NextResponse.json({ error: "Erro ao criar lead." }, { status: 503 });
  }

  return NextResponse.json({ lead: rowToClientLead(data as LeadRow) }, { status: 201 });
}
