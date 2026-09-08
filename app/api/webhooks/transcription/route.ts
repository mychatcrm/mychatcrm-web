/**
 * POST /api/webhooks/transcription
 *
 * Callback do provedor de transcrição. Handler DELIBERADAMENTE FINO: valida o
 * segredo, encontra a reunião pelo id do trabalho e enfileira o estágio
 * `transcript`. Buscar o texto e gravar milhares de segmentos aqui seria correr
 * contra o timeout — e o provedor reenviaria o callback ao não receber 200.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { enqueueMeetingJob, triggerMeetingJobProcessor } from "@/lib/server/meeting-jobs";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeEquals(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const expected = process.env.TRANSCRIPTION_WEBHOOK_SECRET?.trim();
  if (!expected || expected.length < 16) {
    console.error("[webhooks/transcription] TRANSCRIPTION_WEBHOOK_SECRET ausente");
    return NextResponse.json({ error: "Não configurado" }, { status: 500 });
  }

  const presented = request.headers.get("x-transcription-secret")?.trim() ?? "";
  if (!presented || !safeEquals(presented, expected)) {
    // Sem detalhe na resposta: um 401 informativo ajudaria quem está tentando.
    console.warn("[webhooks/transcription] segredo inválido");
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const providerJobId =
    typeof body.transcript_id === "string"
      ? body.transcript_id
      : typeof body.id === "string"
        ? body.id
        : "";
  if (!providerJobId) return NextResponse.json({ error: "id ausente" }, { status: 400 });

  const sb = createSupabaseServiceClient();

  // O id do trabalho é o que amarra o callback a UMA reunião. Um callback
  // forjado com id desconhecido não encontra linha e não escreve nada.
  const { data, error } = await sb
    .from("meetings")
    .select("id, tenant_id, status, processing_version")
    .eq("provider_job_id", providerJobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    console.warn("[webhooks/transcription] job desconhecido");
    // 200 de propósito: um id que não é nosso não deve fazer o provedor tentar
    // de novo indefinidamente.
    return NextResponse.json({ ok: true, matched: false });
  }

  const meeting = data as unknown as {
    id: string;
    tenant_id: string;
    status: string;
    processing_version: number;
  };

  // Callback repetido depois de a transcrição já ter sido gravada: nada a fazer.
  if (meeting.status !== "transcribing") {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const status = typeof body.status === "string" ? body.status : "";
  if (status === "error") {
    await sb
      .from("meetings")
      .update({ status: "failed", failed_reason: "transcription_provider_error", updated_at: new Date().toISOString() })
      .eq("tenant_id", meeting.tenant_id)
      .eq("id", meeting.id);

    await appendOperationalAuditEvent({
      tenantId: meeting.tenant_id,
      actorType: "external_integration",
      module: "meetings",
      action: "transcription_failed",
      resourceType: "meeting",
      resourceId: meeting.id,
      status: "error",
      severity: "error",
    });
    return NextResponse.json({ ok: true });
  }

  await enqueueMeetingJob({
    sb,
    tenantId: meeting.tenant_id,
    meetingId: meeting.id,
    stage: "transcript",
  });

  await appendOperationalAuditEvent({
    tenantId: meeting.tenant_id,
    actorType: "external_integration",
    module: "meetings",
    action: "transcription_callback_received",
    resourceType: "meeting",
    resourceId: meeting.id,
    status: "running",
  });

  void triggerMeetingJobProcessor();
  return NextResponse.json({ ok: true });
}
