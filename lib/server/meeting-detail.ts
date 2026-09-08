import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import type { AccessScope } from "@/lib/server/access-scope";
import { getMeetingForSession, type MeetingRecord } from "@/lib/server/meetings-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type MeetingSpeaker = {
  label: string;
  displayName: string | null;
  employeeId: string | null;
  suggestedName: string | null;
  suggestedEvidenceMs: number | null;
  isConfirmed: boolean;
  talkTimeMs: number;
  segmentCount: number;
};

export type MeetingTranscriptSegment = {
  idx: number;
  speakerLabel: string | null;
  startMs: number;
  endMs: number;
  text: string;
};

export type MeetingActionItemRecord = {
  id: string;
  text: string;
  assigneeEmployeeId: string | null;
  assigneeRaw: string | null;
  dueDate: string | null;
  dueDateInferred: boolean;
  priority: "baixa" | "media" | "alta";
  status: "aberta" | "concluida" | "ignorada";
  atMs: number;
  appliedAgendaEventId: string | null;
};

export type MeetingDecisionRecord = {
  id: string;
  text: string;
  atMs: number;
  madeBySpeakerLabel: string | null;
};

export type MeetingChapter = {
  title: string;
  summary: string;
  startMs: number;
  endMs: number;
};

export type MeetingAnalysisRecord = {
  templateKey: string;
  summaryShort: string;
  summaryLong: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MeetingDetail = {
  meeting: MeetingRecord;
  analysis: MeetingAnalysisRecord | null;
  chapters: MeetingChapter[];
  speakers: MeetingSpeaker[];
  actionItems: MeetingActionItemRecord[];
  decisions: MeetingDecisionRecord[];
};

function toChapters(payload: unknown): MeetingChapter[] {
  const list = (payload as { chapters?: unknown })?.chapters;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const chapter = (entry ?? {}) as Record<string, unknown>;
    const title = String(chapter.title ?? "").trim();
    if (!title) return [];
    return [
      {
        title,
        summary: String(chapter.summary ?? ""),
        startMs: Number(chapter.startMs ?? 0),
        endMs: Number(chapter.endMs ?? 0),
      },
    ];
  });
}

/**
 * Detalhe completo de uma reunião.
 *
 * O escopo é resolvido UMA vez, em `getMeetingForSession`. As consultas
 * seguintes já filtram por `meeting_id` de uma reunião comprovadamente
 * acessível — não há caminho por onde um id de outra empresa chegue aqui.
 */
export async function getMeetingDetail(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
}): Promise<MeetingDetail | null> {
  const meeting = await getMeetingForSession(params);
  if (!meeting) return null;

  const version = meeting.processingVersion;
  const [analyses, speakers, actionItems, decisions] = await Promise.all([
    params.sb
      .from("meeting_analyses")
      .select("template_key, summary_short, summary_long, payload, created_at")
      .eq("tenant_id", meeting.tenantId)
      .eq("meeting_id", meeting.id)
      .eq("processing_version", version),
    params.sb
      .from("meeting_speakers")
      .select(
        "label, display_name, employee_id, suggested_name, suggested_evidence_ms, is_confirmed, talk_time_ms, segment_count",
      )
      .eq("tenant_id", meeting.tenantId)
      .eq("meeting_id", meeting.id)
      .order("label", { ascending: true }),
    params.sb
      .from("meeting_action_items")
      .select(
        "id, text, assignee_employee_id, assignee_raw, due_date, due_date_inferred, priority, status, at_ms, applied_agenda_event_id",
      )
      .eq("tenant_id", meeting.tenantId)
      .eq("meeting_id", meeting.id)
      .eq("processing_version", version)
      .order("at_ms", { ascending: true }),
    params.sb
      .from("meeting_decisions")
      .select("id, text, at_ms, made_by_speaker_label")
      .eq("tenant_id", meeting.tenantId)
      .eq("meeting_id", meeting.id)
      .eq("processing_version", version)
      .order("at_ms", { ascending: true }),
  ]);

  const analysisRows = (analyses.data ?? []) as unknown as Array<Record<string, unknown>>;
  // Os capítulos saem da própria análise (`payload.chapters`). Vinham do
  // provedor de transcrição até o `auto_chapters` ser depreciado; tê-los na
  // mesma resposta custa quase nada e evita duas fontes para a mesma linha do
  // tempo se contradizerem.
  const analysisRow = analysisRows[0];

  return {
    meeting,
    analysis: analysisRow
      ? {
          templateKey: String(analysisRow.template_key),
          summaryShort: String(analysisRow.summary_short ?? ""),
          summaryLong: String(analysisRow.summary_long ?? ""),
          payload:
            analysisRow.payload && typeof analysisRow.payload === "object"
              ? (analysisRow.payload as Record<string, unknown>)
              : {},
          createdAt: String(analysisRow.created_at ?? ""),
        }
      : null,
    chapters: toChapters(analysisRow?.payload),
    speakers: ((speakers.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      label: String(row.label),
      displayName: typeof row.display_name === "string" ? row.display_name : null,
      employeeId: typeof row.employee_id === "string" ? row.employee_id : null,
      suggestedName: typeof row.suggested_name === "string" ? row.suggested_name : null,
      suggestedEvidenceMs:
        row.suggested_evidence_ms === null || row.suggested_evidence_ms === undefined
          ? null
          : Number(row.suggested_evidence_ms),
      isConfirmed: row.is_confirmed === true,
      talkTimeMs: Number(row.talk_time_ms ?? 0),
      segmentCount: Number(row.segment_count ?? 0),
    })),
    actionItems: ((actionItems.data ?? []) as unknown as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id),
        text: String(row.text ?? ""),
        assigneeEmployeeId:
          typeof row.assignee_employee_id === "string" ? row.assignee_employee_id : null,
        assigneeRaw: typeof row.assignee_raw === "string" ? row.assignee_raw : null,
        dueDate: typeof row.due_date === "string" ? row.due_date : null,
        dueDateInferred: row.due_date_inferred === true,
        priority: String(row.priority ?? "media") as MeetingActionItemRecord["priority"],
        status: String(row.status ?? "aberta") as MeetingActionItemRecord["status"],
        atMs: Number(row.at_ms ?? 0),
        appliedAgendaEventId:
          typeof row.applied_agenda_event_id === "string" ? row.applied_agenda_event_id : null,
      }),
    ),
    decisions: ((decisions.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      text: String(row.text ?? ""),
      atMs: Number(row.at_ms ?? 0),
      madeBySpeakerLabel:
        typeof row.made_by_speaker_label === "string" ? row.made_by_speaker_label : null,
    })),
  };
}

export async function getMeetingTranscript(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  meetingId: string;
}): Promise<MeetingTranscriptSegment[] | null> {
  const meeting = await getMeetingForSession(params);
  if (!meeting) return null;

  const { data, error } = await params.sb
    .from("meeting_transcript_segments")
    .select("idx, speaker_label, start_ms, end_ms, text")
    .eq("tenant_id", meeting.tenantId)
    .eq("meeting_id", meeting.id)
    .eq("processing_version", meeting.processingVersion)
    .order("idx", { ascending: true });

  if (error) throw new Error("meeting_transcript_read_failed");
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    idx: Number(row.idx),
    speakerLabel: typeof row.speaker_label === "string" ? row.speaker_label : null,
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: String(row.text ?? ""),
  }));
}
