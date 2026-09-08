import "server-only";

import crypto from "crypto";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import { resolveOrganizationRole } from "@/lib/organization-role";
import {
  leadInScope,
  SCOPABLE_LEAD_COLUMNS,
  type AccessScope,
  type ScopableLead,
} from "@/lib/server/access-scope";
import {
  buildMeetingVisibilityFilter,
  loadMeetingInScope,
} from "@/lib/server/meeting-access-scope";
import {
  isMeetingVisibility,
  type MeetingSource,
  type MeetingStatus,
  type MeetingVisibility,
} from "@/lib/meetings/types";
import { audioExtensionFor, isAcceptedAudioMimeType } from "@/lib/meetings/audio-formats";
import { resolveAudioRetentionUntil } from "@/lib/meetings/plan-limits";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type MeetingRecord = {
  id: string;
  tenantId: string;
  createdByEmployeeId: string | null;
  teamId: string | null;
  leadId: string | null;
  title: string;
  meetingType: string;
  language: string;
  source: MeetingSource;
  tags: string[];
  visibility: MeetingVisibility;
  status: MeetingStatus;
  storageBucket: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
  uploadId: string | null;
  durationMs: number | null;
  recordedAt: string | null;
  processingVersion: number;
  provider: string | null;
  userNotes: string;
  retentionUntil: string | null;
  audioDeletedAt: string | null;
  failedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Colunas devolvidas ao painel. `provider_job_id` fica de fora de proposito. */
const MEETING_COLUMNS = [
  "id",
  "tenant_id",
  "created_by_employee_id",
  "team_id",
  "lead_id",
  "title",
  "meeting_type",
  "language",
  "source",
  "tags",
  "visibility",
  "status",
  "storage_bucket",
  "storage_key",
  "size_bytes",
  "mime_type",
  "upload_id",
  "duration_ms",
  "recorded_at",
  "processing_version",
  "provider",
  "user_notes",
  "retention_until",
  "audio_deleted_at",
  "failed_reason",
  "created_at",
  "updated_at",
].join(", ");

export function toMeetingRecord(row: Record<string, unknown>): MeetingRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    createdByEmployeeId:
      typeof row.created_by_employee_id === "string" ? row.created_by_employee_id : null,
    teamId: typeof row.team_id === "string" ? row.team_id : null,
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    title: String(row.title ?? ""),
    meetingType: String(row.meeting_type ?? "geral"),
    language: String(row.language ?? "pt"),
    source: row.source === "upload" ? "upload" : "record",
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
    visibility: isMeetingVisibility(row.visibility) ? row.visibility : "private",
    status: String(row.status ?? "draft") as MeetingStatus,
    storageBucket: String(row.storage_bucket ?? ""),
    storageKey: String(row.storage_key ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    mimeType: String(row.mime_type ?? ""),
    uploadId: typeof row.upload_id === "string" ? row.upload_id : null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    recordedAt: typeof row.recorded_at === "string" ? row.recorded_at : null,
    processingVersion: Number(row.processing_version ?? 1),
    provider: typeof row.provider === "string" ? row.provider : null,
    userNotes: String(row.user_notes ?? ""),
    retentionUntil: typeof row.retention_until === "string" ? row.retention_until : null,
    audioDeletedAt: typeof row.audio_deleted_at === "string" ? row.audio_deleted_at : null,
    failedReason: typeof row.failed_reason === "string" ? row.failed_reason : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

/**
 * Caminho do objeto no R2.
 *
 * Sempre `meetings/{tenantId}/...`, e a extensao vem do mime type validado —
 * nunca do nome do arquivo enviado, que e entrada nao confiavel e nao pode
 * influenciar o caminho no storage. O prefixo do tenant e o que a rota de
 * leitura confere antes de assinar uma URL, e o banco reforca em
 * `reserve_meeting_v1`.
 */
export function buildMeetingStorageKey(params: {
  tenantId: string;
  meetingId: string;
  mimeType: string;
}): string {
  const ext = audioExtensionFor(params.mimeType);
  if (!ext) throw new Error("meeting_mime_type_not_supported");
  return `meetings/${params.tenantId}/${params.meetingId}/audio.${ext}`;
}

/** Visibilidade padrao: lead vinculado manda; senao, o papel de quem gravou. */
export function defaultVisibilityForSession(
  session: ClientSession,
  hasLead: boolean,
): MeetingVisibility {
  if (hasLead) return "lead";
  const role = resolveOrganizationRole(session);
  if (role === "owner") return "company";
  if (role === "director" || role === "manager") return "team";
  return "private";
}

/**
 * Equipe carimbada na reuniao.
 *
 * Herdar a equipe do lead mantem a reuniao no mesmo recorte que ja governa o
 * lead e a conversa. Sem lead, so carimba quando o colaborador pertence a
 * exatamente uma equipe — um diretor em varias nao tem resposta obvia, e chutar
 * uma delas colocaria a reuniao no recorte errado.
 */
async function resolveMeetingTeamId(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  employeeId: string | null;
  lead: ScopableLead | null;
}): Promise<string | null> {
  if (params.lead?.team_id) return params.lead.team_id;
  if (!params.employeeId) return null;

  const { data, error } = await params.sb
    .from("team_members")
    .select("team_id")
    .eq("tenant_id", params.tenantId)
    .eq("employee_id", params.employeeId);

  if (error) {
    console.error("[meetings-db] team lookup failed", error.message);
    return null;
  }
  const teamIds = Array.from(
    new Set((data ?? []).map((row) => String((row as { team_id: string }).team_id))),
  );
  return teamIds.length === 1 ? (teamIds[0] as string) : null;
}

export type CreateMeetingInput = {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  source: MeetingSource;
  mimeType: string;
  title?: string;
  meetingType?: string;
  language?: string;
  leadId?: string | null;
  visibility?: string | null;
  consentAcknowledged?: boolean;
};

export async function createMeeting(input: CreateMeetingInput): Promise<MeetingRecord> {
  if (!isAcceptedAudioMimeType(input.mimeType)) {
    throw new Error("meeting_mime_type_not_supported");
  }

  const tenantId = input.session.tenantId;
  const employeeId = input.session.employeeId?.trim() || null;

  // Vincular a um lead que a pessoa nao alcanca seria uma forma de descobrir
  // que ele existe — e, pior, de compartilhar a gravacao com quem cuida dele.
  let lead: ScopableLead | null = null;
  const leadId = input.leadId?.trim() || null;
  if (leadId) {
    const { data } = await input.sb
      .from("leads")
      .select(SCOPABLE_LEAD_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", leadId)
      .maybeSingle();
    lead = (data as ScopableLead | null) ?? null;
    if (!lead || !leadInScope(lead, input.scope)) {
      throw new Error("meeting_lead_not_found");
    }
  }

  const visibility = isMeetingVisibility(input.visibility)
    ? input.visibility
    : defaultVisibilityForSession(input.session, Boolean(leadId));

  if (visibility === "lead" && !leadId) {
    throw new Error("meeting_lead_visibility_requires_lead");
  }

  const teamId = await resolveMeetingTeamId({
    sb: input.sb,
    tenantId,
    employeeId,
    lead,
  });

  const meetingId = crypto.randomUUID();
  const storageKey = buildMeetingStorageKey({ tenantId, meetingId, mimeType: input.mimeType });

  const { data, error } = await input.sb.rpc("reserve_meeting_v1", {
    p_meeting_id: meetingId,
    p_tenant_id: tenantId,
    p_created_by_employee_id: employeeId,
    p_team_id: teamId,
    p_lead_id: leadId,
    p_title: input.title?.trim() ?? "",
    p_meeting_type: input.meetingType?.trim() || "geral",
    p_visibility: visibility,
    p_source: input.source,
    p_language: input.language?.trim() || "pt",
    p_storage_bucket: "",
    p_storage_key: storageKey,
    p_mime_type: input.mimeType,
    p_retention_until: resolveAudioRetentionUntil(input.session.plan).toISOString(),
    p_consent_ack_at: input.consentAcknowledged ? new Date().toISOString() : null,
  });

  if (error) throw new Error(error.message || "meeting_create_failed");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("meeting_create_failed");
  return toMeetingRecord(row);
}

export async function getMeetingForSession(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
}): Promise<MeetingRecord | null> {
  const row = await loadMeetingInScope<Record<string, unknown>>(
    params.sb,
    params.session.tenantId,
    params.meetingId,
    params.scope,
    params.session,
  );
  return row ? toMeetingRecord(row) : null;
}

export type ListMeetingsFilters = {
  search?: string;
  status?: MeetingStatus;
  meetingType?: string;
  leadId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export async function listMeetingsForSession(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  filters?: ListMeetingsFilters;
}): Promise<{ meetings: MeetingRecord[]; hasMore: boolean }> {
  const filters = params.filters ?? {};
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  const visibility = await buildMeetingVisibilityFilter(
    params.sb,
    params.session.tenantId,
    params.scope,
    params.session,
  );
  if (visibility.kind === "none") return { meetings: [], hasMore: false };

  let query = params.sb
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("tenant_id", params.session.tenantId)
    .is("deleted_at", null);

  // O recorte entra NA QUERY. Filtrar em memoria depois de ler tudo e
  // exatamente o erro que `access-scope.ts` foi criado para corrigir.
  if (visibility.kind === "or") query = query.or(visibility.expression);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.meetingType) query = query.eq("meeting_type", filters.meetingType);
  if (filters.leadId) query = query.eq("lead_id", filters.leadId);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.search?.trim()) {
    // `%` e `,` quebrariam a expressao do PostgREST; `\` escaparia o proximo
    // caractere. Removidos antes de entrar no filtro.
    const term = filters.search.trim().replace(/[%,\\]/g, "").slice(0, 120);
    if (term) query = query.ilike("title", `%${term}%`);
  }

  // Pede um a mais para saber se ha proxima pagina sem um count separado.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    console.error("[meetings-db] list failed", error.message);
    throw new Error("meeting_list_failed");
  }

  // `MEETING_COLUMNS` e montado em runtime, entao o supabase-js nao consegue
  // inferir a forma da linha e devolve `GenericStringError`. O `unknown` no
  // meio e o que o proprio compilador pede; `toMeetingRecord` valida campo a
  // campo logo abaixo.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const meetings = rows.slice(0, limit).map(toMeetingRecord);

  return { meetings, hasMore };
}

export type MeetingListExtras = {
  summaryLine?: string;
  speakerCount?: number;
  actionItemCount?: number;
  decisionCount?: number;
};

/**
 * Resumo e contagens dos cards.
 *
 * Três consultas em lote, não uma por reunião: com 30 cards na tela, o N+1
 * custaria 90 idas ao banco para preencher uma linha de texto cada.
 */
export async function loadMeetingListExtras(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  meetings: MeetingRecord[];
}): Promise<Record<string, MeetingListExtras>> {
  const ids = params.meetings.map((meeting) => meeting.id);
  if (ids.length === 0) return {};

  const [analyses, speakers, tasks, decisions] = await Promise.all([
    params.sb
      .from("meeting_analyses")
      .select("meeting_id, summary_short, template_key")
      .eq("tenant_id", params.tenantId)
      .in("meeting_id", ids),
    params.sb
      .from("meeting_speakers")
      .select("meeting_id")
      .eq("tenant_id", params.tenantId)
      .in("meeting_id", ids),
    params.sb
      .from("meeting_action_items")
      .select("meeting_id")
      .eq("tenant_id", params.tenantId)
      .eq("status", "aberta")
      .in("meeting_id", ids),
    params.sb
      .from("meeting_decisions")
      .select("meeting_id")
      .eq("tenant_id", params.tenantId)
      .in("meeting_id", ids),
  ]);

  const extras: Record<string, MeetingListExtras> = {};
  const bump = (id: string, key: "speakerCount" | "actionItemCount" | "decisionCount") => {
    const entry = (extras[id] ??= {});
    entry[key] = (entry[key] ?? 0) + 1;
  };

  for (const row of (analyses.data ?? []) as unknown as Array<Record<string, unknown>>) {
    // O registro "chapters" guarda só a timeline do provedor e não tem resumo.
    if (row.template_key === "chapters") continue;
    const id = String(row.meeting_id);
    const summary = String(row.summary_short ?? "").trim();
    if (summary) (extras[id] ??= {}).summaryLine = summary;
  }
  for (const row of (speakers.data ?? []) as unknown as Array<Record<string, unknown>>) {
    bump(String(row.meeting_id), "speakerCount");
  }
  for (const row of (tasks.data ?? []) as unknown as Array<Record<string, unknown>>) {
    bump(String(row.meeting_id), "actionItemCount");
  }
  for (const row of (decisions.data ?? []) as unknown as Array<Record<string, unknown>>) {
    bump(String(row.meeting_id), "decisionCount");
  }

  return extras;
}

export type UpdateMeetingInput = {
  title?: string;
  meetingType?: string;
  tags?: string[];
  visibility?: string;
  leadId?: string | null;
  userNotes?: string;
};

export async function updateMeetingForSession(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
  patch: UpdateMeetingInput;
}): Promise<MeetingRecord | null> {
  const current = await getMeetingForSession(params);
  if (!current) return null;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (params.patch.title !== undefined) patch.title = params.patch.title.trim().slice(0, 300);
  if (params.patch.meetingType !== undefined) {
    const type = params.patch.meetingType.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,48}$/.test(type)) throw new Error("meeting_type_invalid");
    patch.meeting_type = type;
  }
  if (params.patch.tags !== undefined) {
    patch.tags = params.patch.tags
      .map((tag) => tag.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (params.patch.userNotes !== undefined) {
    patch.user_notes = params.patch.userNotes.slice(0, 20000);
  }

  // Trocar o lead pode mudar quem alcanca a reuniao, entao o lead novo precisa
  // estar no escopo de quem esta editando.
  let nextLeadId = current.leadId;
  if (params.patch.leadId !== undefined) {
    const leadId = params.patch.leadId?.trim() || null;
    if (leadId) {
      const { data } = await params.sb
        .from("leads")
        .select(SCOPABLE_LEAD_COLUMNS)
        .eq("tenant_id", params.session.tenantId)
        .eq("id", leadId)
        .maybeSingle();
      const lead = (data as ScopableLead | null) ?? null;
      if (!lead || !leadInScope(lead, params.scope)) throw new Error("meeting_lead_not_found");
      patch.team_id = lead.team_id ?? current.teamId;
    }
    patch.lead_id = leadId;
    nextLeadId = leadId;
  }

  if (params.patch.visibility !== undefined) {
    if (!isMeetingVisibility(params.patch.visibility)) throw new Error("meeting_visibility_invalid");
    if (params.patch.visibility === "lead" && !nextLeadId) {
      throw new Error("meeting_lead_visibility_requires_lead");
    }
    patch.visibility = params.patch.visibility;
  }

  // Desvincular o lead deixaria uma reuniao `lead` invisivel para todos menos o
  // titular. Cai para `private`, que e o padrao conservador.
  if (patch.lead_id === null && (patch.visibility ?? current.visibility) === "lead") {
    patch.visibility = "private";
  }

  const { data, error } = await params.sb
    .from("meetings")
    .update(patch)
    .eq("tenant_id", params.session.tenantId)
    .eq("id", params.meetingId)
    .select(MEETING_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(error.message || "meeting_update_failed");
  return data ? toMeetingRecord(data as unknown as Record<string, unknown>) : null;
}

/**
 * Exclusao em duas etapas: marca aqui, e o job de retencao apaga o objeto do R2
 * e as linhas. Apagar a linha primeiro deixaria o audio orfao no bucket — sem
 * ponteiro, ninguem saberia que ele existe para remover depois.
 */
export async function softDeleteMeetingForSession(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
}): Promise<boolean> {
  const current = await getMeetingForSession(params);
  if (!current) return false;

  const now = new Date().toISOString();
  const { error } = await params.sb
    .from("meetings")
    .update({ deleted_at: now, retention_until: now, updated_at: now })
    .eq("tenant_id", params.session.tenantId)
    .eq("id", params.meetingId)
    .is("deleted_at", null);

  if (error) {
    console.error("[meetings-db] soft delete failed", error.message);
    return false;
  }
  return true;
}
