import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { deleteCrmLeadsForTenant, normalizeCrmLeadIds, validateCrmLeadIds } from "@/lib/server/crm-leads-delete";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { resolveAccessScope, scopeMatchesNothing } from "@/lib/server/access-scope";
import type { ClientLead } from "@/lib/dashboard-data";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";

export const dynamic = "force-dynamic";

const BASE_LEAD_SELECT = "id, tenant_id, name, phone, email, source, status, notes, agent_id, last_seen, last_message_at, created_at, updated_at";
const LEAD_SELECT_WITH_FUNNEL = `${BASE_LEAD_SELECT}, crm_funnel_id, owner_employee_id`;
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

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
  crm_funnel_id?: string | null;
  owner_employee_id?: string | null;
};

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_funnel_id") || message.includes("owner_employee_id");
}

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

function normalizeSource(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function sourceDisplay(source: string): { origem: string; tag: string; tags: string[] } {
  const normalized = normalizeSource(source);
  if (normalized.includes("whatsapp")) {
    return {
      origem: normalized.includes("campaign") ? "Campanha WhatsApp" : "WhatsApp",
      tag: "WhatsApp",
      tags: normalized.includes("campaign") ? ["WhatsApp", "Campanha"] : ["WhatsApp", "Novo"],
    };
  }
  if (normalized.includes("facebook") || normalized.includes("meta") || normalized.includes("lead_ads") || normalized.includes("form")) {
    return { origem: "Meta / Facebook", tag: "Meta", tags: ["Meta", "Formulário"] };
  }
  return { origem: "Entrada manual", tag: "Novo", tags: ["Novo", "Manual"] };
}

function rowToClientLead(row: LeadRow, ownerNamesById?: Map<string, string>): ClientLead {
  const source = row.source?.trim() || "manual";
  const agent = row.agent_id?.trim() || "Agente padrão · CRM";
  const sourceView = sourceDisplay(source);
  const ownerEmployeeId = row.owner_employee_id?.trim() || undefined;
  const ownerName = ownerEmployeeId ? ownerNamesById?.get(ownerEmployeeId) ?? "Atendente" : "Equipe";
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
    tag: sourceView.tag,
    agenteEntrada: agent,
    agenteAtendendo: agent,
    responsavel: ownerName,
    ownerEmployeeId,
    ultimoContato: formatRelativeContact(row.last_message_at ?? row.last_seen ?? row.updated_at ?? row.created_at),
    proximaAcao: row.notes?.trim() || "Qualificar interesse",
    origem: sourceView.origem,
    tags: sourceView.tags,
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
  const crmFunnelId = textOrNull(body.crm_funnel_id) ?? textOrNull(body.funilId);
  if (crmFunnelId) payload.crm_funnel_id = crmFunnelId;
  const ownerEmployeeId = textOrNull(body.owner_employee_id) ?? textOrNull(body.ownerEmployeeId);
  if (ownerEmployeeId) payload.owner_employee_id = ownerEmployeeId;
  return payload;
}

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sb = createSupabaseServiceClient();

  // Recorte por equipe/dono aplicado NA QUERY: nenhum lead fora do escopo sai
  // do servidor, nem para quem chamar a API por fora do painel.
  const scope = await resolveAccessScope(sb, session);
  if (scopeMatchesNothing(scope)) {
    return NextResponse.json({ leads: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const scopedQuery = (select: string) => {
    const base = sb
      .from("leads")
      .select(select)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false });
    if (scope.kind === "own") return base.eq("owner_employee_id", scope.employeeId);
    if (scope.kind === "teams") return base.in("team_id", scope.teamIds);
    return base;
  };

  const initial = await scopedQuery(LEAD_SELECT_WITH_FUNNEL);
  let data: unknown[] | null = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const fallback = await scopedQuery(BASE_LEAD_SELECT);
    data = fallback.data as unknown[] | null;
    error = fallback.error;
  }

  if (error) {
    console.error("[api/client/crm/leads] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar leads." }, { status: 503 });
  }

  const ownerNamesById = new Map((await readTeamMembersFromDb(session.tenantId, session.email)).map((employee) => [employee.id, employee.nome]));
  const rows = (data ?? []) as LeadRow[];
  const leads = rows.map((row) => rowToClientLead(row, ownerNamesById));
  const statuses = [...new Set(leads.map((lead) => lead.status))].sort();
  const funnels = [...new Set(leads.map((lead) => lead.funilId))].sort();
  console.warn("[crm-leads-api]", {
    tenant_id: session.tenantId,
    total: leads.length,
    whatsapp: leads.filter((lead) => lead.origem === "WhatsApp").length,
    funnels,
    statuses,
  });

  return NextResponse.json({ leads }, { headers: { "Cache-Control": "no-store" } });
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
  const contactKey = String(payload.phone ?? payload.email ?? payload.id ?? "").trim();
  let existingContact = false;
  if (contactKey) {
    const existingQuery = String(payload.phone ?? "").trim()
      ? sb.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", session.tenantId).eq("phone", payload.phone)
      : sb.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", session.tenantId).eq("email", payload.email);
    const { count } = await existingQuery;
    existingContact = (count ?? 0) > 0;
  }
  const admission = await reserveTenantLeadQuota({
    tenantId: session.tenantId,
    plan: session.plan,
    operationalLimits: session.operationalLimits,
    contactKey,
    source: "crm_manual",
    idempotencyKey: `crm-api:${session.tenantId}:${String(payload.id ?? contactKey)}`,
    isExistingContact: existingContact,
    metadata: { source: payload.source ?? "manual", created_by: session.email },
  });
  if (!admission.admitted) {
    return NextResponse.json(
      {
        error:
          admission.reason === "lead_quota_exhausted"
            ? "O limite de novos leads do ciclo foi atingido. Contrate mais capacidade para criar um novo lead."
            : "Não foi possível confirmar a franquia de leads. Tente novamente em instantes.",
        code: admission.reason,
      },
      { status: admission.reason === "lead_quota_exhausted" ? 429 : 503 },
    );
  }
  const initial = await sb
    .from("leads")
    .insert(payload)
    .select(LEAD_SELECT_WITH_FUNNEL)
    .single();
  let data: unknown = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error) && "crm_funnel_id" in payload) {
    const { crm_funnel_id: _crmFunnelId, owner_employee_id: _ownerEmployeeId, ...fallbackPayload } = payload;
    const fallback = await sb
      .from("leads")
      .insert(fallbackPayload)
      .select(BASE_LEAD_SELECT)
      .single();
    data = fallback.data as unknown;
    error = fallback.error;
  }

  if (error) {
    await releaseTenantLeadQuotaReservation(admission.eventId, "crm_manual_insert_failed");
    console.error("[api/client/crm/leads] POST", error.code, error.message);
    return NextResponse.json({ error: "Erro ao criar lead." }, { status: 503 });
  }

  await commitTenantLeadQuotaReservation({
    eventId: admission.eventId,
    leadId: (data as LeadRow).id,
  });

  const ownerNamesById = new Map((await readTeamMembersFromDb(session.tenantId, session.email)).map((employee) => [employee.id, employee.nome]));
  return NextResponse.json({ lead: rowToClientLead(data as LeadRow, ownerNamesById) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const ids = normalizeCrmLeadIds(body.ids);
  const validationError = validateCrmLeadIds(ids);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    const result = await deleteCrmLeadsForTenant({ sb, tenantId: session.tenantId, ids });
    return NextResponse.json({ ok: true, ids: result.deletedIds, count: result.deletedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao apagar lead(s).";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
