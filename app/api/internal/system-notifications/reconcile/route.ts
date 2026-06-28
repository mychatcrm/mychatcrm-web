import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { reconcileStalePendingNotifications } from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return POST(request);
}

/** Marca pending >60s como delivery_failed (cron Vercel). */
export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const updated = await reconcileStalePendingNotifications(60);
  return NextResponse.json({ ok: true, updated });
}
