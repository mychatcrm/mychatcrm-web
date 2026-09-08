/**
 * GET  /api/client/reunioes — biblioteca de reuniões, já recortada pelo escopo.
 * POST /api/client/reunioes — cria a reunião em rascunho e reserva a chave no R2.
 */
import { NextResponse } from "next/server";
import {
  meetingRouteError,
  readJsonBody,
  requireMeetingRouteContext,
} from "@/lib/server/meetings-route-guard";
import {
  createMeeting,
  listMeetingsForSession,
  loadMeetingListExtras,
} from "@/lib/server/meetings-db";
import { getMeetingQuotaState } from "@/lib/server/meeting-quota";
import type { MeetingStatus } from "@/lib/meetings/types";

export const dynamic = "force-dynamic";

const STATUSES = new Set<MeetingStatus>([
  "draft",
  "uploading",
  "queued",
  "transcribing",
  "analyzing",
  "completed",
  "partial",
  "failed",
]);

export async function GET(request: Request) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  try {
    const [result, quota] = await Promise.all([
      listMeetingsForSession({
        sb,
        session,
        scope,
        filters: {
          search: url.searchParams.get("busca") ?? undefined,
          status: status && STATUSES.has(status as MeetingStatus) ? (status as MeetingStatus) : undefined,
          meetingType: url.searchParams.get("tipo") ?? undefined,
          leadId: url.searchParams.get("leadId") ?? undefined,
          from: url.searchParams.get("de") ?? undefined,
          to: url.searchParams.get("ate") ?? undefined,
          limit: Number.isFinite(limit) ? limit : 30,
          offset: Number.isFinite(offset) ? offset : 0,
        },
      }),
      getMeetingQuotaState(sb, session),
    ]);

    const extras = await loadMeetingListExtras({
      sb,
      tenantId: session.tenantId,
      meetings: result.meetings,
    });

    return NextResponse.json(
      {
        meetings: result.meetings.map((meeting) => ({ ...meeting, ...(extras[meeting.id] ?? {}) })),
        hasMore: result.hasMore,
        quota,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return meetingRouteError(error);
  }
}

export async function POST(request: Request) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });

  const source = body.source === "upload" ? "upload" : "record";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  if (!mimeType) return NextResponse.json({ error: "Formato de áudio ausente." }, { status: 400 });

  try {
    const meeting = await createMeeting({
      sb,
      session,
      scope,
      source,
      mimeType,
      title: typeof body.title === "string" ? body.title : undefined,
      meetingType: typeof body.meetingType === "string" ? body.meetingType : undefined,
      language: typeof body.language === "string" ? body.language : undefined,
      leadId: typeof body.leadId === "string" ? body.leadId : null,
      visibility: typeof body.visibility === "string" ? body.visibility : null,
      consentAcknowledged: body.consentAcknowledged === true,
    });

    return NextResponse.json({ meeting }, { status: 201 });
  } catch (error) {
    return meetingRouteError(error);
  }
}
