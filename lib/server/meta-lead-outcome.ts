import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { KANBAN_COLUMNS } from "@/lib/constants";
import type { MetaLeadOutcomeFilter } from "@/lib/meta-leads/central-filters";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Resultado comercial de um lead pago.
 *
 * A Central deixa de responder só "o webhook chegou?" e passa a responder "o
 * que aconteceu com este lead?". Tudo aqui é junção com dados que já existem —
 * `leads` (etapa do funil, dono, equipe, primeira resposta) e `agenda_events`
 * (agendamento pelo telefone). Nada é inventado: não há valor de negócio
 * persistido no CRM hoje, então receita não é reportada.
 */

export type LeadOutcome = {
  leadId: string;
  status: string | null;
  funnelId: string | null;
  columnLabel: string | null;
  value: number | null;
  ownerName: string | null;
  teamName: string | null;
  respondedAt: string | null;
  firstReplyMinutes: number | null;
  scheduledAt: string | null;
  scheduleStatus: string | null;
  temperature: string | null;
  outcome: MetaLeadOutcomeFilter;
};

const WON_COLUMN_IDS = new Set(["fechado", "ganho", "vendido"]);
const LOST_COLUMN_IDS = new Set(["perdido", "descartado"]);

const COLUMN_TITLES = new Map<string, string>(KANBAN_COLUMNS.map((column) => [column.id, column.title]));

/**
 * Funil personalizado pode ter coluna com id próprio: além dos ids do sistema,
 * o nome também conta. "Fechado ✓" e "Venda concluída" são o mesmo desfecho.
 */
export function classifyColumn(columnId: string | null): "won" | "lost" | "open" {
  const id = columnId?.trim().toLowerCase();
  if (!id) return "open";
  if (WON_COLUMN_IDS.has(id)) return "won";
  if (LOST_COLUMN_IDS.has(id)) return "lost";
  if (/(fechad|ganh|vendid|convertid)/.test(id)) return "won";
  if (/(perdid|descartad|desqualific)/.test(id)) return "lost";
  return "open";
}

type LeadRow = {
  id: string;
  phone: string | null;
  status: string | null;
  crm_funnel_id: string | null;
  team_id: string | null;
  owner_employee_id: string | null;
  first_reply_at: string | null;
  lead_temperature: string | null;
  created_at: string | null;
};

type AgendaRow = { attendee_phone: string | null; start_at: string; status: string };

const LOOKUP_CHUNK = 200;

function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Últimos 8 dígitos: contorna 9º dígito e DDI escritos de formas diferentes. */
function phoneKey(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

async function loadInChunks<T>(
  ids: string[],
  loader: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const collected: T[] = [];
  for (let index = 0; index < ids.length; index += LOOKUP_CHUNK) {
    collected.push(...(await loader(ids.slice(index, index + LOOKUP_CHUNK))));
  }
  return collected;
}

export async function resolveLeadOutcomes(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  leadIds: string[];
}): Promise<Map<string, LeadOutcome>> {
  const { sb, tenantId } = params;
  const leadIds = Array.from(new Set(params.leadIds.filter(Boolean)));
  const result = new Map<string, LeadOutcome>();
  if (leadIds.length === 0) return result;

  const leads = await loadInChunks<LeadRow>(leadIds, async (chunk) => {
    const { data, error } = await sb
      .from("leads")
      .select(
        "id, phone, status, crm_funnel_id, team_id, owner_employee_id, first_reply_at, lead_temperature, created_at",
      )
      .eq("tenant_id", tenantId)
      .in("id", chunk);
    if (error) throw new Error(`lead_outcome_leads_failed: ${error.message}`);
    return (data ?? []) as unknown as LeadRow[];
  });

  if (leads.length === 0) return result;

  // Agendamentos casam pelo telefone: `agenda_events` não guarda `lead_id`.
  const phoneKeys = new Set(leads.map((lead) => phoneKey(lead.phone)).filter(Boolean));
  const agendaByPhone = new Map<string, AgendaRow>();
  const leadPhones = Array.from(
    new Set(leads.map((lead) => lead.phone?.trim()).filter((phone): phone is string => Boolean(phone))),
  );
  if (phoneKeys.size > 0 && leadPhones.length > 0) {
    // Consulta pelos telefones desta página, e não pela agenda inteira do
    // tenant: o agendamento é criado com o telefone do próprio lead, então é o
    // recorte certo e custa uma fração.
    const rows = await loadInChunks<AgendaRow>(leadPhones, async (chunk) => {
      const { data } = await sb
        .from("agenda_events")
        .select("attendee_phone, start_at, status")
        .eq("tenant_id", tenantId)
        .in("attendee_phone", chunk);
      return (data ?? []) as AgendaRow[];
    });

    for (const row of rows) {
      const key = phoneKey(row.attendee_phone);
      if (!key || !phoneKeys.has(key)) continue;
      const current = agendaByPhone.get(key);
      // Cancelado não apaga um agendamento confirmado do mesmo contato.
      if (!current || (current.status === "cancelled" && row.status !== "cancelled")) {
        agendaByPhone.set(key, row);
      }
    }
  }

  const teamNames = new Map<string, string>();
  const teamIds = Array.from(new Set(leads.map((lead) => lead.team_id).filter(Boolean))) as string[];
  if (teamIds.length > 0) {
    const { data } = await sb.from("teams").select("id, name").eq("tenant_id", tenantId).in("id", teamIds);
    for (const row of (data ?? []) as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof row.id === "string" && typeof row.name === "string") teamNames.set(row.id, row.name);
    }
  }

  const employeeNames = new Map<string, string>();
  const employeeIds = Array.from(
    new Set(leads.map((lead) => lead.owner_employee_id).filter(Boolean)),
  ) as string[];
  if (employeeIds.length > 0) {
    // O nome do colaborador vive em `tenant_members`; `team_members` só liga
    // colaborador a equipe.
    const { data } = await sb
      .from("tenant_members")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .in("id", employeeIds);
    for (const row of (data ?? []) as Array<{ id?: unknown; nome?: unknown }>) {
      if (typeof row.id === "string" && typeof row.nome === "string") {
        employeeNames.set(row.id, row.nome);
      }
    }
  }

  for (const lead of leads) {
    const agenda = agendaByPhone.get(phoneKey(lead.phone)) ?? null;
    const columnClass = classifyColumn(lead.status);
    const firstReplyMinutes =
      lead.first_reply_at && lead.created_at
        ? Math.max(
            0,
            Math.round(
              (new Date(lead.first_reply_at).getTime() - new Date(lead.created_at).getTime()) / 60_000,
            ),
          )
        : null;

    // Precedência: o desfecho fechado manda sobre o meio do caminho.
    const outcome: MetaLeadOutcomeFilter =
      columnClass === "won"
        ? "ganho"
        : columnClass === "lost"
          ? "perdido"
          : agenda && agenda.status !== "cancelled"
            ? "agendou"
            : lead.first_reply_at
              ? "respondeu"
              : "sem_contato";

    result.set(lead.id, {
      leadId: lead.id,
      status: lead.status,
      funnelId: lead.crm_funnel_id,
      columnLabel: lead.status ? (COLUMN_TITLES.get(lead.status) ?? lead.status) : null,
      value: null,
      ownerName: lead.owner_employee_id ? (employeeNames.get(lead.owner_employee_id) ?? null) : null,
      teamName: lead.team_id ? (teamNames.get(lead.team_id) ?? null) : null,
      respondedAt: lead.first_reply_at,
      firstReplyMinutes,
      scheduledAt: agenda?.start_at ?? null,
      scheduleStatus: agenda?.status ?? null,
      temperature: lead.lead_temperature,
      outcome,
    });
  }

  return result;
}

/**
 * Ids dos leads que casam com os desfechos pedidos.
 *
 * O desfecho vive no CRM, não em `meta_lead_events`, então o filtro é resolvido
 * primeiro e entra na consulta principal como restrição por `lead_id` — a mesma
 * mecânica do recorte por equipe.
 */
export async function resolveLeadIdsForOutcomes(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  outcomes: MetaLeadOutcomeFilter[];
  maxLeads?: number;
}): Promise<Set<string>> {
  const { sb, tenantId, outcomes } = params;
  const matching = new Set<string>();
  if (outcomes.length === 0) return matching;

  const maxLeads = Math.max(1, params.maxLeads ?? 20_000);
  const { data, error } = await sb
    .from("leads")
    .select("id, phone, status, first_reply_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("source", "lead_ads")
    .limit(maxLeads);
  if (error) throw new Error(`lead_outcome_filter_failed: ${error.message}`);

  const leads = (data ?? []) as Array<{
    id: string;
    phone: string | null;
    status: string | null;
    first_reply_at: string | null;
  }>;

  const wanted = new Set(outcomes);
  const needsAgenda = wanted.has("agendou");
  const agendaKeys = new Set<string>();
  if (needsAgenda) {
    const { data: agenda } = await sb
      .from("agenda_events")
      .select("attendee_phone, status")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .not("attendee_phone", "is", null)
      .limit(5000);
    for (const row of (agenda ?? []) as Array<{ attendee_phone: string | null }>) {
      const key = phoneKey(row.attendee_phone);
      if (key) agendaKeys.add(key);
    }
  }

  for (const lead of leads) {
    const columnClass = classifyColumn(lead.status);
    const hasAgenda = needsAgenda && agendaKeys.has(phoneKey(lead.phone));
    const outcome: MetaLeadOutcomeFilter =
      columnClass === "won"
        ? "ganho"
        : columnClass === "lost"
          ? "perdido"
          : hasAgenda
            ? "agendou"
            : lead.first_reply_at
              ? "respondeu"
              : "sem_contato";
    if (wanted.has(outcome)) matching.add(lead.id);
  }

  return matching;
}
