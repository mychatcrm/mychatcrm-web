/**
 * POST /api/internal/meetings/watchdog
 *
 * Rede de segurança do pipeline, chamada a cada minuto pelo pg_cron. Cobre os
 * três buracos que o disparo imediato não cobre:
 *
 *  1. Reunião `queued` sem job — o `fetch` de disparo falhou depois do upload.
 *  2. Reunião `transcribing` há tempo demais — o callback do provedor se
 *     perdeu; reconsulta em vez de esperar para sempre.
 *  3. Jobs prontos parados — processa o que estiver na fila.
 *
 * Leases vencidas são recuperadas dentro da própria RPC de claim.
 */
import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import {
  MEETINGS_WATCHDOG_SCHEDULER_PATH,
  verifySignedSchedulerRequest,
} from "@/lib/server/meta-scheduler-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { enqueueMeetingJob } from "@/lib/server/meeting-jobs";
import { processDueMeetingJobs } from "@/lib/server/meeting-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Tempo sem callback a partir do qual reconsultamos o provedor. */
const TRANSCRIBING_STALE_MINUTES = 45;

export async function POST(request: Request) {
  // Duas portas: token interno (operação, cron da Vercel) e assinatura HMAC do
  // Supabase/Vault, que é como o pg_cron chama. O caminho entra na assinatura,
  // então uma chamada válida para outro worker não é reaproveitável aqui.
  const bearerAuthorized = verifyInternalApiRequest(request, {
    allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"],
  });
  const signedAuth = bearerAuthorized
    ? null
    : verifySignedSchedulerRequest(request, MEETINGS_WATCHDOG_SCHEDULER_PATH);

  if (!bearerAuthorized && !signedAuth?.ok) {
    return NextResponse.json(
      { error: signedAuth?.status === 503 ? "Scheduler não configurado." : "Não autorizado" },
      { status: signedAuth?.status ?? 401 },
    );
  }

  const sb = createSupabaseServiceClient();
  const recovered = { queuedWithoutJob: 0, staleTranscribing: 0 };

  try {
    // (1) `queued` é o estado logo após o upload. Se ficou aí, o disparo do job
    // não aconteceu — reenfileirar é idempotente.
    const { data: queued } = await sb
      .from("meetings")
      .select("id, tenant_id")
      .eq("status", "queued")
      .is("deleted_at", null)
      .lt("updated_at", new Date(Date.now() - 2 * 60_000).toISOString())
      .limit(20);

    for (const row of (queued ?? []) as Array<{ id: string; tenant_id: string }>) {
      const ok = await enqueueMeetingJob({
        sb,
        tenantId: row.tenant_id,
        meetingId: row.id,
        stage: "prepare",
      });
      if (ok) recovered.queuedWithoutJob += 1;
    }

    // (2) Callback perdido: enfileira o estágio que busca o resultado ativamente.
    const staleCutoff = new Date(Date.now() - TRANSCRIBING_STALE_MINUTES * 60_000).toISOString();
    const { data: stale } = await sb
      .from("meetings")
      .select("id, tenant_id")
      .eq("status", "transcribing")
      .is("deleted_at", null)
      .lt("updated_at", staleCutoff)
      .limit(20);

    for (const row of (stale ?? []) as Array<{ id: string; tenant_id: string }>) {
      const ok = await enqueueMeetingJob({
        sb,
        tenantId: row.tenant_id,
        meetingId: row.id,
        stage: "transcript",
      });
      if (ok) recovered.staleTranscribing += 1;
    }

    // (3) Drena a fila.
    const processed = await processDueMeetingJobs({ sb, limit: 3 });

    return NextResponse.json({ ok: true, recovered, ...processed });
  } catch (error) {
    console.error("[meetings/watchdog]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
