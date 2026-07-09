import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientSession } from "@/lib/client-auth";
import {
  canCreateActiveOffer,
  canDispositionLead,
  canManageActiveOffer,
  canViewActiveOfferProgress,
  offerVisibleToEmployee,
} from "@/lib/server/active-offers-auth";
import { matchActiveOfferLeads, normalizeActiveOfferFilter } from "@/lib/server/active-offers-filter";
import {
  ACTIVE_OFFER_LEAD_SELECT,
  attachProgressToLead,
  daysSinceContact,
  rowToActiveOfferClientLead,
  type ActiveOfferLeadWithProgress,
} from "@/lib/server/active-offers-lead-mapper";
import type {
  ActiveOfferCreatedVia,
  ActiveOfferDisposition,
  ActiveOfferDistributionMode,
  ActiveOfferFilterInput,
  ActiveOfferFilterSnapshot,
  ActiveOfferProgressStats,
} from "@/lib/active-offers-types";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";

type OfferRow = {
  id: string;
  tenant_id: string;
  title: string | null;
  status: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_via: string | null;
  filter_snapshot: ActiveOfferFilterSnapshot | null;
  distribution_mode: string | null;
  archived_at: string | null;
};

type ProgressRow = {
  lead_id: string;
  assigned_employee_id: string | null;
  disposition: string;
  attempt_count: number;
  last_attempt_at: string | null;
  disposition_at: string | null;
  disposition_by: string | null;
  notes: string | null;
};

const OFFER_SELECT =
  "id, tenant_id, title, status, created_by, created_at, updated_at, created_via, filter_snapshot, distribution_mode, archived_at";

const COMPLETED_DISPOSITIONS = new Set<ActiveOfferDisposition>([
  "answered_transfer",
  "answered_not_interested",
  "do_not_call",
]);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toOfferSummary(row: OfferRow, leadCount: number, stats?: ActiveOfferProgressStats) {
  return {
    id: row.id,
    title: row.title?.trim() || "Oferta ativa",
    status: row.status?.trim() || "active",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdVia: (row.created_via?.trim() || "manual_crm") as "manual_crm" | "smart_filter",
    filterSnapshot: row.filter_snapshot ?? null,
    distributionMode: (row.distribution_mode?.trim() || "shared_pool") as ActiveOfferDistributionMode,
    archivedAt: row.archived_at,
    leadCount,
    progress: stats ?? null,
  };
}

function computeStats(rows: Array<{ disposition: string }>): ActiveOfferProgressStats {
  const stats: ActiveOfferProgressStats = {
    pending: 0,
    noAnswer: 0,
    answeredTransfer: 0,
    answeredNotInterested: 0,
    doNotCall: 0,
    total: rows.length,
    completed: 0,
  };
  for (const row of rows) {
    switch (row.disposition) {
      case "no_answer":
        stats.noAnswer += 1;
        break;
      case "answered_transfer":
        stats.answeredTransfer += 1;
        stats.completed += 1;
        break;
      case "answered_not_interested":
        stats.answeredNotInterested += 1;
        stats.completed += 1;
        break;
      case "do_not_call":
        stats.doNotCall += 1;
        stats.completed += 1;
        break;
      default:
        stats.pending += 1;
    }
  }
  return stats;
}

async function loadAssigneeIds(sb: SupabaseClient, tenantId: string, offerId: string): Promise<string[]> {
  const { data } = await sb
    .from("active_offer_assignees")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("active_offer_id", offerId);
  return (data ?? [])
    .map((row) => (row as { employee_id?: unknown }).employee_id)
    .filter((id): id is string => typeof id === "string");
}

async function loadProgressRows(
  sb: SupabaseClient,
  tenantId: string,
  offerId: string,
  sellerEmployeeId?: string,
): Promise<ProgressRow[]> {
  let query = sb
    .from("active_offer_lead_progress")
    .select("lead_id, assigned_employee_id, disposition, attempt_count, last_attempt_at, disposition_at, disposition_by, notes")
    .eq("tenant_id", tenantId)
    .eq("active_offer_id", offerId);

  if (sellerEmployeeId) {
    query = query.or(`assigned_employee_id.eq.${sellerEmployeeId},assigned_employee_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw new Error("Erro ao carregar progresso da oferta.");
  return (data ?? []) as ProgressRow[];
}

function splitLeadIdsEvenly(leadIds: string[], employeeIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of employeeIds) map.set(id, []);
  employeeIds.forEach((employeeId, index) => {
    const bucket = map.get(employeeId)!;
    for (let i = index; i < leadIds.length; i += employeeIds.length) {
      bucket.push(leadIds[i]!);
    }
  });
  return map;
}

async function ensureLegacyProgressRows(sb: SupabaseClient, tenantId: string, offerId: string) {
  const { data: links } = await sb
    .from("active_offer_leads")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("active_offer_id", offerId);

  const leadIds = (links ?? [])
    .map((row) => (row as { lead_id?: unknown }).lead_id)
    .filter((id): id is string => typeof id === "string");

  if (!leadIds.length) return;

  const now = new Date().toISOString();
  const rows = leadIds.map((leadId) => ({
    tenant_id: tenantId,
    active_offer_id: offerId,
    lead_id: leadId,
    disposition: "pending",
    attempt_count: 0,
    updated_at: now,
  }));

  for (const batch of chunk(rows, 500)) {
    await sb.from("active_offer_lead_progress").upsert(batch, {
      onConflict: "active_offer_id,lead_id",
      ignoreDuplicates: true,
    });
  }
}

export async function previewActiveOffer(
  sb: SupabaseClient,
  session: ClientSession,
  filter: ActiveOfferFilterInput,
) {
  if (!canCreateActiveOffer(session)) throw new Error("Sem permissão para criar listas de ligação.");
  const normalized = normalizeActiveOfferFilter(filter);
  const { leadIds, matchCount } = await matchActiveOfferLeads(sb, session.tenantId, normalized);
  const sampleRows = leadIds.length
    ? await sb
        .from("leads")
        .select(ACTIVE_OFFER_LEAD_SELECT)
        .eq("tenant_id", session.tenantId)
        .in("id", leadIds.slice(0, 10))
    : { data: [], error: null };

  if (sampleRows.error) throw new Error("Erro ao carregar amostra.");

  const employees = await readTeamMembersFromDb(session.tenantId, session.email);
  const ownerNames = new Map(employees.filter((e) => e.ativo).map((e) => [e.id, e.nome]));

  return {
    matchCount,
    cappedCount: leadIds.length,
    sampleLeads: ((sampleRows.data ?? []) as Parameters<typeof rowToActiveOfferClientLead>[0][]).map((row) => ({
      ...rowToActiveOfferClientLead(row, ownerNames),
      daysSinceContact: daysSinceContact(row),
    })),
  };
}

export async function createActiveOfferFromFilter(
  sb: SupabaseClient,
  session: ClientSession,
  params: {
    title: string;
    filter: ActiveOfferFilterInput;
    assigneeEmployeeIds: string[];
    distributionMode: ActiveOfferDistributionMode;
  },
) {
  if (!canCreateActiveOffer(session)) throw new Error("Sem permissão para criar listas de ligação.");

  const title = params.title.trim();
  if (!title) throw new Error("Informe um título para a lista.");

  const normalized = normalizeActiveOfferFilter(params.filter);
  const { leadIds } = await matchActiveOfferLeads(sb, session.tenantId, normalized);
  if (!leadIds.length) throw new Error("Nenhum lead encontrado com os filtros selecionados.");

  const now = new Date().toISOString();
  const filterSnapshot: ActiveOfferFilterSnapshot = {
    kanbanStages: normalized.kanbanStages,
    minDaysInactive: normalized.minDaysInactive,
    ownerEmployeeIds: normalized.ownerEmployeeIds,
    includeUnassigned: normalized.includeUnassigned,
    sources: normalized.sources,
    excludeOptOut: normalized.excludeOptOut,
  };

  const { data: offer, error: offerError } = await sb
    .from("active_offers")
    .insert({
      tenant_id: session.tenantId,
      title,
      status: "active",
      created_by: session.email,
      created_via: "smart_filter",
      filter_snapshot: filterSnapshot,
      distribution_mode: params.distributionMode,
      updated_at: now,
    })
    .select(OFFER_SELECT)
    .single();

  if (offerError || !offer) throw new Error("Erro ao criar lista de ligação.");

  const offerId = (offer as OfferRow).id;
  const linkRows = leadIds.map((leadId) => ({
    tenant_id: session.tenantId,
    active_offer_id: offerId,
    lead_id: leadId,
  }));

  for (const batch of chunk(linkRows, 500)) {
    const { error } = await sb.from("active_offer_leads").upsert(batch, {
      onConflict: "active_offer_id,lead_id",
      ignoreDuplicates: true,
    });
    if (error) throw new Error("Erro ao vincular leads à lista.");
  }

  const assigneeIds = params.assigneeEmployeeIds.filter(Boolean);
  if (assigneeIds.length) {
    const assigneeRows = assigneeIds.map((employeeId) => ({
      tenant_id: session.tenantId,
      active_offer_id: offerId,
      employee_id: employeeId,
    }));
    const { error } = await sb.from("active_offer_assignees").insert(assigneeRows);
    if (error) throw new Error("Erro ao atribuir vendedores.");
  }

  const distributionTargets =
    params.distributionMode === "split_evenly" && assigneeIds.length ? assigneeIds : assigneeIds;

  const splitMap =
    params.distributionMode === "split_evenly" && distributionTargets.length
      ? splitLeadIdsEvenly(leadIds, distributionTargets)
      : null;

  const progressRows = leadIds.map((leadId) => {
    let assignedEmployeeId: string | null = null;
    if (splitMap) {
      for (const [employeeId, ids] of splitMap.entries()) {
        if (ids.includes(leadId)) {
          assignedEmployeeId = employeeId;
          break;
        }
      }
    }
    return {
      tenant_id: session.tenantId,
      active_offer_id: offerId,
      lead_id: leadId,
      assigned_employee_id: assignedEmployeeId,
      disposition: "pending",
      attempt_count: 0,
      updated_at: now,
    };
  });

  for (const batch of chunk(progressRows, 500)) {
    const { error } = await sb.from("active_offer_lead_progress").upsert(batch, {
      onConflict: "active_offer_id,lead_id",
      ignoreDuplicates: true,
    });
    if (error) throw new Error("Erro ao inicializar progresso dos leads.");
  }

  return toOfferSummary(
    offer as OfferRow,
    leadIds.length,
    computeStats(progressRows.map((row) => ({ disposition: row.disposition }))),
  );
}

export async function listActiveOffersForSession(sb: SupabaseClient, session: ClientSession) {
  const isManagerView = canViewActiveOfferProgress(session);

  const { data: offers, error } = await sb
    .from("active_offers")
    .select(OFFER_SELECT)
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("Erro ao carregar listas de ligação.");

  const offerRows = (offers ?? []) as OfferRow[];
  if (!offerRows.length) return [];

  const offerIds = offerRows.map((o) => o.id);
  const { data: assigneeRows } = await sb
    .from("active_offer_assignees")
    .select("active_offer_id, employee_id")
    .eq("tenant_id", session.tenantId)
    .in("active_offer_id", offerIds);

  const assigneesByOffer = new Map<string, string[]>();
  for (const row of assigneeRows ?? []) {
    const offerId = (row as { active_offer_id?: string }).active_offer_id;
    const employeeId = (row as { employee_id?: string }).employee_id;
    if (typeof offerId !== "string" || typeof employeeId !== "string") continue;
    const list = assigneesByOffer.get(offerId) ?? [];
    list.push(employeeId);
    assigneesByOffer.set(offerId, list);
  }

  const visibleOffers = offerRows.filter((offer) => {
    if (resolveOrganizationRole(session) === "seller" && offer.archived_at) return false;
    return offerVisibleToEmployee({
      assigneeIds: assigneesByOffer.get(offer.id) ?? [],
      employeeId: session.employeeId,
      isCreatorOrManager: isManagerView,
    });
  });

  if (!visibleOffers.length) return [];

  for (const offer of visibleOffers) {
    await ensureLegacyProgressRows(sb, session.tenantId, offer.id);
  }

  const visibleIds = visibleOffers.map((o) => o.id);
  const { data: progressRows } = await sb
    .from("active_offer_lead_progress")
    .select("active_offer_id, disposition")
    .eq("tenant_id", session.tenantId)
    .in("active_offer_id", visibleIds);

  const statsByOffer = new Map<string, Array<{ disposition: string }>>();
  for (const row of progressRows ?? []) {
    const offerId = (row as { active_offer_id?: string }).active_offer_id;
    if (typeof offerId !== "string") continue;
    const list = statsByOffer.get(offerId) ?? [];
    list.push({ disposition: String((row as { disposition?: unknown }).disposition ?? "pending") });
    statsByOffer.set(offerId, list);
  }

  return visibleOffers.map((offer) => {
    const progress = statsByOffer.get(offer.id) ?? [];
    return toOfferSummary(offer, progress.length, computeStats(progress));
  });
}

export async function getActiveOfferDetail(
  sb: SupabaseClient,
  session: ClientSession,
  offerId: string,
  options?: { sellerQueueOnly?: boolean },
) {
  const { data: offer, error } = await sb
    .from("active_offers")
    .select(OFFER_SELECT)
    .eq("tenant_id", session.tenantId)
    .eq("id", offerId)
    .single();

  if (error || !offer) throw new Error("Lista de ligação não encontrada.");

  const offerRow = offer as OfferRow;
  await ensureLegacyProgressRows(sb, session.tenantId, offerId);
  const assigneeIds = await loadAssigneeIds(sb, session.tenantId, offerId);
  const isManagerView = canViewActiveOfferProgress(session);

  if (
    !offerVisibleToEmployee({
      assigneeIds,
      employeeId: session.employeeId,
      isCreatorOrManager: isManagerView,
    })
  ) {
    throw new Error("Sem permissão para ver esta lista.");
  }

  const sellerEmployeeId =
    resolveOrganizationRole(session) === "seller" ? session.employeeId : undefined;

  let progressRows = await loadProgressRows(sb, session.tenantId, offerId, sellerEmployeeId);

  if (offerRow.distribution_mode === "split_evenly" && sellerEmployeeId) {
    progressRows = progressRows.filter(
      (row) => !row.assigned_employee_id || row.assigned_employee_id === sellerEmployeeId,
    );
  }

  if (options?.sellerQueueOnly) {
    progressRows = progressRows.filter(
      (row) => !COMPLETED_DISPOSITIONS.has(row.disposition as ActiveOfferDisposition),
    );
  }

  const leadIds = progressRows.map((row) => row.lead_id);
  let leads: ActiveOfferLeadWithProgress[] = [];

  if (leadIds.length) {
    const { data: leadRows, error: leadsError } = await sb
      .from("leads")
      .select(ACTIVE_OFFER_LEAD_SELECT)
      .eq("tenant_id", session.tenantId)
      .in("id", leadIds);

    if (leadsError) throw new Error("Erro ao carregar leads da lista.");

    const employees = await readTeamMembersFromDb(session.tenantId, session.email);
    const ownerNames = new Map(employees.filter((e) => e.ativo).map((e) => [e.id, e.nome]));
    const progressByLead = new Map(progressRows.map((row) => [row.lead_id, row]));
    const rowById = new Map(
      ((leadRows ?? []) as Parameters<typeof rowToActiveOfferClientLead>[0][]).map((row) => [row.id, row]),
    );

    leads = leadIds
      .map((leadId) => {
        const row = rowById.get(leadId);
        const progress = progressByLead.get(leadId);
        if (!row || !progress) return null;
        return attachProgressToLead(rowToActiveOfferClientLead(row, ownerNames), {
          disposition: progress.disposition,
          attemptCount: progress.attempt_count,
          lastAttemptAt: progress.last_attempt_at,
          assignedEmployeeId: progress.assigned_employee_id,
          notes: progress.notes,
          daysSinceContact: daysSinceContact(row),
        });
      })
      .filter((lead): lead is ActiveOfferLeadWithProgress => lead !== null);
  }

  const allProgress = await loadProgressRows(sb, session.tenantId, offerId);
  const stats = computeStats(allProgress);

  const sellerProgress =
    sellerEmployeeId
      ? computeStats(
          allProgress.filter(
            (row) => !row.assigned_employee_id || row.assigned_employee_id === sellerEmployeeId,
          ),
        )
      : stats;

  return {
    offer: {
      ...toOfferSummary(offerRow, stats.total, stats),
      assigneeIds,
      leads,
      sellerProgress,
    },
  };
}

export async function archiveActiveOffer(sb: SupabaseClient, session: ClientSession, offerId: string) {
  if (!canManageActiveOffer(session)) throw new Error("Sem permissão para arquivar.");
  const now = new Date().toISOString();
  const { error } = await sb
    .from("active_offers")
    .update({ archived_at: now, updated_at: now })
    .eq("tenant_id", session.tenantId)
    .eq("id", offerId);
  if (error) throw new Error("Erro ao arquivar lista.");
  return { ok: true as const };
}

export async function applyLeadDisposition(
  sb: SupabaseClient,
  session: ClientSession,
  offerId: string,
  leadId: string,
  disposition: ActiveOfferDisposition,
  notes?: string,
) {
  const { data: offer, error: offerError } = await sb
    .from("active_offers")
    .select("id, distribution_mode, archived_at")
    .eq("tenant_id", session.tenantId)
    .eq("id", offerId)
    .single();

  if (offerError || !offer) throw new Error("Lista não encontrada.");
  if ((offer as { archived_at?: string | null }).archived_at) throw new Error("Lista arquivada.");

  const assigneeIds = await loadAssigneeIds(sb, session.tenantId, offerId);

  const { data: progress, error: progressError } = await sb
    .from("active_offer_lead_progress")
    .select("lead_id, assigned_employee_id, disposition, attempt_count")
    .eq("tenant_id", session.tenantId)
    .eq("active_offer_id", offerId)
    .eq("lead_id", leadId)
    .single();

  if (progressError || !progress) throw new Error("Lead não encontrado nesta lista.");

  const progressRow = progress as ProgressRow;
  if (
    !canDispositionLead({
      session,
      assigneeIds,
      assignedEmployeeId: progressRow.assigned_employee_id,
      distributionMode: String((offer as { distribution_mode?: string }).distribution_mode ?? "shared_pool"),
    })
  ) {
    throw new Error("Sem permissão para registrar resultado deste lead.");
  }

  const now = new Date().toISOString();
  const cleanNotes = notes?.trim() || null;
  const attemptCount =
    disposition === "no_answer" ? (progressRow.attempt_count ?? 0) + 1 : progressRow.attempt_count ?? 0;

  const progressPatch: Record<string, unknown> = {
    disposition,
    attempt_count: attemptCount,
    last_attempt_at: now,
    disposition_at: disposition === "no_answer" ? null : now,
    disposition_by: session.email,
    notes: cleanNotes,
    updated_at: now,
  };

  if (resolveOrganizationRole(session) === "seller" && session.employeeId && !progressRow.assigned_employee_id) {
    progressPatch.assigned_employee_id = session.employeeId;
  }

  const { error: updateProgressError } = await sb
    .from("active_offer_lead_progress")
    .update(progressPatch)
    .eq("tenant_id", session.tenantId)
    .eq("active_offer_id", offerId)
    .eq("lead_id", leadId);

  if (updateProgressError) throw new Error("Erro ao registrar resultado.");

  const leadPatch: Record<string, unknown> = { updated_at: now };

  if (disposition === "answered_transfer" && session.employeeId) {
    leadPatch.owner_employee_id = session.employeeId;
    if (cleanNotes) leadPatch.notes = cleanNotes;
  } else if (disposition === "answered_not_interested") {
    leadPatch.status = "perdido";
    if (cleanNotes) leadPatch.notes = cleanNotes;
  } else if (disposition === "do_not_call") {
    leadPatch.whatsapp_opt_out_at = now;
    leadPatch.notes = cleanNotes ?? "Pediu para não ligar mais";
  } else if (disposition === "no_answer" && cleanNotes) {
    leadPatch.notes = cleanNotes;
  }

  if (Object.keys(leadPatch).length > 1) {
    const { error: leadError } = await sb
      .from("leads")
      .update(leadPatch)
      .eq("tenant_id", session.tenantId)
      .eq("id", leadId);
    if (leadError) throw new Error("Erro ao atualizar lead no CRM.");
  }

  return { ok: true as const, disposition, attemptCount };
}

export async function getOfferProgressBySeller(
  sb: SupabaseClient,
  session: ClientSession,
  offerId: string,
) {
  if (!canViewActiveOfferProgress(session)) throw new Error("Sem permissão.");
  const progressRows = await loadProgressRows(sb, session.tenantId, offerId);
  const bySeller = new Map<string, ActiveOfferProgressStats>();

  for (const row of progressRows) {
    const key = row.assigned_employee_id ?? "sem_atribuicao";
    const current = bySeller.get(key) ?? {
      pending: 0,
      noAnswer: 0,
      answeredTransfer: 0,
      answeredNotInterested: 0,
      doNotCall: 0,
      total: 0,
      completed: 0,
    };
    const next = computeStats([row]);
    bySeller.set(key, {
      pending: current.pending + next.pending,
      noAnswer: current.noAnswer + next.noAnswer,
      answeredTransfer: current.answeredTransfer + next.answeredTransfer,
      answeredNotInterested: current.answeredNotInterested + next.answeredNotInterested,
      doNotCall: current.doNotCall + next.doNotCall,
      total: current.total + 1,
      completed: current.completed + next.completed,
    });
  }

  return Array.from(bySeller.entries()).map(([employeeId, stats]) => ({ employeeId, stats }));
}
