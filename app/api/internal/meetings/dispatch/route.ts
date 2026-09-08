/**
 * POST /api/internal/meetings/dispatch
 *
 * Processa os jobs de reunião que já estão prontos. Chamado fire-and-forget
 * depois de cada transição do pipeline e, como rede de segurança, pelo
 * watchdog de minuto do pg_cron.
 *
 * maxDuration 120: nenhum estágio precisa de mais que isso por desenho — a
 * transcrição roda no provedor, não aqui.
 */
import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { processDueMeetingJobs } from "@/lib/server/meeting-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await processDueMeetingJobs({ limit: 3 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[meetings/dispatch]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
