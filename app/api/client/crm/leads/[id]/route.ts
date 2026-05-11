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

function leadPayloadToUpdate(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const pairs: Array<[string, unknown]> = [
    ["name", textOrNull(body.name) ?? textOrNull(body.nome)],
    ["phone", textOrNull(body.phone) ?? textOrNull(body.telefone)],
    ["email", textOrNull(body.email)],
    ["source", textOrNull(body.source) ?? textOrNull(body.origem)],
    ["status", textOrNull(body.status)],
    ["notes", textOrNull(body.notes) ?? textOrNull(body.proximaAcao)],
    ["agent_id", textOrNull(body.agent_id) ?? textOrNull(body.agenteAtendendo) ?? textOrNull(body.agenteEntrada)],
    ["last_seen", textOrNull(body.last_seen)],
    ["last_message_at", textOrNull(body.last_message_at)],
  ];

  for (const [key, value] of pairs) {
    if (value !== null) patch[key] = value;
  }

  return patch;
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!params.id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .update(leadPayloadToUpdate(body))
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .select("id, tenant_id, name, phone, email, source, status, notes, agent_id, last_seen, last_message_at, created_at, updated_at")
    .single();

  if (error) {
    console.error("[api/client/crm/leads] PUT", error.code, error.message);
    return NextResponse.json({ error: "Erro ao atualizar lead." }, { status: 503 });
  }

  return NextResponse.json({ lead: rowToClientLead(data as LeadRow) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!params.id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("leads")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id);

  if (error) {
    console.error("[api/client/crm/leads] DELETE", error.code, error.message);
    return NextResponse.json({ error: "Erro ao remover lead." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
