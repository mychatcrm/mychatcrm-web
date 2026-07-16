import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { reconcileOrphanDeliveryEvents, reconcileUndeliveredNotifications } from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return POST(request);
}

/** Marca pending >60s como delivery_failed (cron Vercel). */
export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const [timedOut, orphanResult] = await Promise.all([
    reconcileUndeliveredNotifications(60),
    reconcileOrphanDeliveryEvents(),
  ]);
  return NextResponse.json({
    ok: true,
    updated: timedOut,
    orphansApplied: orphanResult.applied,
    orphansRemaining: orphanResult.remaining,
  });
}
