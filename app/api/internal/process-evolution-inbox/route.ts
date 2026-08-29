import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { processEvolutionWebhookInbox } from "@/lib/server/evolution-webhook-inbox";
import { internalApiAuthHeaders, verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { EVOLUTION_INBOX_SCHEDULER_PATH, verifySignedSchedulerRequest } from "@/lib/server/meta-scheduler-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  return processEvolutionWebhookInbox({
    origin: new URL(request.url).origin,
    authHeaders: internalApiAuthHeaders(),
    batchSize: 3,
    deadlineMs: 240_000,
  });
}

export async function GET(request: Request) { return POST(request); }

export async function POST(request: Request) {
  const bearerAuthorized = verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "AGENT_RESPONSE_JOBS_SECRET", "CRON_SECRET"] });
  const signed = bearerAuthorized ? null : verifySignedSchedulerRequest(request, EVOLUTION_INBOX_SCHEDULER_PATH);
  if (!bearerAuthorized && !signed?.ok) return NextResponse.json({ error: "Não autorizado" }, { status: signed?.status ?? 401 });
  if (signed?.ok) {
    waitUntil(run(request).catch((error) => console.error("[evolution-inbox] scheduled_failed", {
      error: error instanceof Error ? error.message : "process_failed",
    })));
    return NextResponse.json({ ok: true, accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  try { return NextResponse.json({ ok: true, ...(await run(request)) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "process_failed" }, { status: 500 }); }
}
