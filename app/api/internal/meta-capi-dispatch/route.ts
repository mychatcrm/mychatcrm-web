/**
 * POST/GET /api/internal/meta-capi-dispatch
 *
 * Worker da fila de conversões para a Meta. A reivindicação é atómica no
 * Postgres (`claim_meta_capi_events_v1`), então este endpoint pode ser chamado
 * pelo pg_cron e pela rede de segurança da Vercel ao mesmo tempo sem enviar a
 * mesma conversão duas vezes.
 */
// operational-audit: reconciled — deliverPendingCapiEvents regista cada envio.

import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import {
  META_CAPI_DISPATCH_SCHEDULER_PATH,
  verifySignedSchedulerRequest,
} from "@/lib/server/meta-scheduler-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { deliverPendingCapiEvents } from "@/lib/server/meta-capi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  // Dois chamadores legítimos: o pg_cron (HMAC assinado com o caminho dentro da
  // assinatura, então não é replicável noutro worker) e a rede de segurança da
  // Vercel (Bearer).
  const bearerAuthorized = verifyInternalApiRequest(request, {
    allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"],
  });
  if (!bearerAuthorized) {
    const signed = verifySignedSchedulerRequest(request, META_CAPI_DISPATCH_SCHEDULER_PATH);
    if (!signed.ok) {
      return NextResponse.json({ error: "unauthorized", code: signed.code }, { status: signed.status });
    }
  }

  try {
    const sb = createSupabaseServiceClient();
    const result = await deliverPendingCapiEvents({ sb, limit: 25 });
    console.info("[meta-capi]", { event: "dispatch_completed", ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "dispatch_failed";
    console.error("[meta-capi]", { event: "dispatch_error", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
