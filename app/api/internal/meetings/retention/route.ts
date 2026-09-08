/**
 * POST /api/internal/meetings/retention
 * Varredura diária: apaga áudio vencido e conclui exclusões pedidas.
 */
import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { sweepMeetingRetention } from "@/lib/server/meeting-retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await sweepMeetingRetention();
    console.info("[meetings/retention]", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[meetings/retention]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
