import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { deleteCrmLeadsForTenant, normalizeCrmLeadIds, validateCrmLeadIds } from "@/lib/server/crm-leads-delete";
import {
  normalizeAllowedStatusIds,
  validateLeadFunnelIdForUpdate,
  validateLeadStatusForUpdate,
} from "@/lib/server/crm-lead-status-validation";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { loadLeadInScope, resolveAccessScope } from "@/lib/server/access-scope";
import type { ClientLead } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

const BASE_LEAD_SELECT = "id, tenant_id, name, phone, email, source, status, notes, agent_id, last_seen, last_message_at, created_at, updated_at";
const LEAD_SELECT_WITH_FUNNEL = `${BASE_LEAD_SELECT}, crm_funnel_id, owner_employee_id`;
const LEAD_SELECT_WITH_ORDER = `${LEAD_SELECT_WITH_FUNNEL}, crm_position`;
const LEAD_SELECT_WITH_PROFILE = `${LEAD_SELECT_WITH_ORDER}, profile_metadata`;
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
  crm_position?: number | string | null;
  profile_metadata?: Record<string, unknown> | null;
};

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code)) || message.includes("crm_funnel_id") || message.includes("owner_employee_id") || message.includes("crm_position");
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
    crmPosition: row.crm_position == null ? undefined : Number(row.crm_position),
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
    ["owner_employee_id", textOrNull(body.owner_employee_id) ?? textOrNull(body.ownerEmployeeId)],
    ["last_seen", textOrNull(body.last_seen)],
    ["last_message_at", textOrNull(body.last_message_at)],
    ["crm_funnel_id", textOrNull(body.crm_funnel_id) ?? textOrNull(body.funilId)],
  ];

  for (const [key, value] of pairs) {
    if (value !== null) patch[key] = value;
  }

  return patch;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!params.id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  // 404 (não 403) quando o lead é de outra equipe/vendedor: não revela que existe.
  const scope = await resolveAccessScope(sb, session);
  if (!(await loadLeadInScope(sb, session.tenantId, params.id, scope))) {
    return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  }

  const initial = await sb
    .from("leads")
    .select(LEAD_SELECT_WITH_PROFILE)
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .maybeSingle();
  let row = initial.data as LeadRow | null;
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const fallback = await sb
      .from("leads")
      .select(LEAD_SELECT_WITH_FUNNEL)
      .eq("tenant_id", session.tenantId)
      .eq("id", params.id)
      .maybeSingle();
    row = (fallback.data as LeadRow | null) ?? null;
    error = fallback.error;
  }

  if (error) {
    console.error("[api/client/crm/leads] GET", error.code, error.message);
    return NextResponse.json({ error: "Erro ao carregar lead." }, { status: 503 });
  }
  if (!row) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });

  const ownerNamesById = new Map(
    (await readTeamMembersFromDb(session.tenantId, session.email)).map((employee) => [employee.id, employee.nome]),
  );
  const profileMetadata =
    row.profile_metadata && typeof row.profile_metadata === "object" && !Array.isArray(row.profile_metadata)
      ? row.profile_metadata
      : {};

  return NextResponse.json({
    lead: rowToClientLead(row, ownerNamesById),
    source: row.source?.trim() || null,
    profile_metadata: profileMetadata,
  });
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

  const statusRaw = textOrNull(body.status);
  const allowedStatusIds = normalizeAllowedStatusIds(body.allowedStatusIds);
  if (statusRaw) {
    const statusError = validateLeadStatusForUpdate(
      statusRaw,
      allowedStatusIds.length ? allowedStatusIds : undefined,
    );
    if (statusError) return NextResponse.json({ error: statusError }, { status: 400 });
  }

  const funnelIdRaw = textOrNull(body.crm_funnel_id) ?? textOrNull(body.funilId);
  if (funnelIdRaw) {
    const funnelError = validateLeadFunnelIdForUpdate(funnelIdRaw);
    if (funnelError) return NextResponse.json({ error: funnelError }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  // Sem isto, qualquer colaborador autenticado podia editar (e reatribuir) lead
  // de outra equipe só chamando a API com o id.
  const scope = await resolveAccessScope(sb, session);
  if (!(await loadLeadInScope(sb, session.tenantId, params.id, scope))) {
    return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  }

  const initial = await sb
    .from("leads")
    .update(leadPayloadToUpdate(body))
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .select(LEAD_SELECT_WITH_ORDER)
    .single();
  let data: unknown = initial.data;
  let error = initial.error;

  if (isMissingColumnError(error)) {
    const { crm_funnel_id: _crmFunnelId, owner_employee_id: _ownerEmployeeId, ...fallbackPatch } = leadPayloadToUpdate(body);
    const fallback = await sb
      .from("leads")
      .update(fallbackPatch)
      .eq("tenant_id", session.tenantId)
      .eq("id", params.id)
      .select(BASE_LEAD_SELECT)
      .single();
    data = fallback.data as unknown;
    error = fallback.error;
  }

  if (error) {
    console.error("[api/client/crm/leads] PUT", error.code, error.message);
    return NextResponse.json({ error: "Erro ao atualizar lead." }, { status: 503 });
  }

  const ownerNamesById = new Map((await readTeamMembersFromDb(session.tenantId, session.email)).map((employee) => [employee.id, employee.nome]));
  return NextResponse.json({ lead: rowToClientLead(data as LeadRow, ownerNamesById) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const ids = normalizeCrmLeadIds(params.id);
  const validationError = validateCrmLeadIds(ids);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const sb = createSupabaseServiceClient();
  // Apaga só o que o escopo alcança. Se algum id estiver fora, responde 404
  // para o lote inteiro, em vez de apagar em silêncio uma parte.
  const scope = await resolveAccessScope(sb, session);
  const inScope = await Promise.all(
    ids.map((id) => loadLeadInScope(sb, session.tenantId, id, scope)),
  );
  if (inScope.some((lead) => !lead)) {
    return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  }

  try {
    const result = await deleteCrmLeadsForTenant({ sb, tenantId: session.tenantId, ids });
    return NextResponse.json({ ok: true, id: result.deletedIds[0] ?? null, ids: result.deletedIds, count: result.deletedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao remover lead.";
    console.error("[api/client/crm/leads] DELETE", message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
