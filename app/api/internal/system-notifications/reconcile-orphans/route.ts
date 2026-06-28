import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import {
  reconcileOrphanDeliveryEvents,
  reconcileUndeliveredNotifications,
} from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return POST(request);
}

/** Reconcilia eventos órfãos de MESSAGES_UPDATE e aplica timeout de pending/sent. */
export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const [orphanResult, timedOut] = await Promise.all([
    reconcileOrphanDeliveryEvents(),
    reconcileUndeliveredNotifications(60),
  ]);

  return NextResponse.json({
    ok: true,
    orphansApplied: orphanResult.applied,
    orphansRemaining: orphanResult.remaining,
    timedOut,
  });
}
