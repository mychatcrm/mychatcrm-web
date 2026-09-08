/**
 * GET /api/client/reunioes/{id}/audio-url
 *
 * URL temporária para o player ler o áudio direto do R2. NÃO reaproveita
 * `/api/client/media/[...key]`, que exige apenas sessão válida e não compara o
 * tenant do caminho com o da sessão — aqui isso seria uma empresa ouvindo a
 * reunião de outra.
 *
 * A URL é gerada sob demanda e nunca persistida: se vazar, expira em 2 h.
 */
import { NextResponse } from "next/server";
import { meetingRouteError, requireMeetingRouteContext } from "@/lib/server/meetings-route-guard";
import { getMeetingForSession } from "@/lib/server/meetings-db";
import { createR2PresignedGetUrl } from "@/lib/integrations/r2-storage";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";

const AUDIO_URL_TTL_SECONDS = 2 * 3600;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await requireMeetingRouteContext();
  if (!guard.ok) return guard.response;
  const { session, scope, sb } = guard.value;

  const meetingId = params.id?.trim();
  if (!meetingId) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const meeting = await getMeetingForSession({ sb, session, scope, meetingId });
    if (!meeting) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });

    if (meeting.audioDeletedAt) {
      return NextResponse.json(
        {
          error: "O áudio desta reunião expirou. Transcrição e análise continuam disponíveis.",
          code: "MEETING_AUDIO_EXPIRED",
        },
        { status: 410 },
      );
    }

    // Terceira camada do isolamento: mesmo com a linha em mãos, a chave tem de
    // viver sob o prefixo do próprio tenant antes de qualquer assinatura.
    if (!meeting.storageKey.startsWith(`meetings/${session.tenantId}/`)) {
      await appendOperationalAuditEvent({
        tenantId: session.tenantId,
        actorType: "customer",
        module: "meetings",
        action: "audio_url_prefix_mismatch",
        resourceType: "meeting",
        resourceId: meetingId,
        status: "blocked",
        severity: "critical",
        critical: true,
      });
      return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
    }

    const url = await createR2PresignedGetUrl({
      key: meeting.storageKey,
      expiresInSeconds: AUDIO_URL_TTL_SECONDS,
    });

    return NextResponse.json(
      { url, expiresInSeconds: AUDIO_URL_TTL_SECONDS, mimeType: meeting.mimeType },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return meetingRouteError(error);
  }
}
