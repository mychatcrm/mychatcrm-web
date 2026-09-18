/**
 * POST /api/client/meta/reconciliation/backfill
 *
 * Importa os leads que a Meta registou e o MyChatCRM não tinha. Por omissão
 * entra só no CRM e na Central: acionar o primeiro contato de um lead de três
 * dias atrás é pior do que não o acionar, e um lote de 200 abriria 200
 * conversas de uma vez. Quem quiser o disparo pede explicitamente.
 */
// operational-audit: reconciled — backfillReconciliationGaps regista a importação.

import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { backfillReconciliationGaps } from "@/lib/server/meta-lead-reconciliation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canSeeSpend } = guard;

  if (!canSeeSpend) {
    return NextResponse.json(
      { error: "Só o titular da conta pode importar leads em falta.", code: "FORBIDDEN_ROLE" },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    runId?: unknown;
    gapIds?: unknown;
    withOutreach?: unknown;
  };

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) return NextResponse.json({ error: "runId obrigatório." }, { status: 400 });

  const gapIds = Array.isArray(body.gapIds)
    ? body.gapIds.map((value) => String(value).trim()).filter(Boolean).slice(0, 500)
    : undefined;

  try {
    const result = await backfillReconciliationGaps({
      sb,
      tenantId: session.tenantId,
      runId,
      gapIds,
      withOutreach: body.withOutreach === true,
      actorId: actorLabel(session),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.startsWith("reconciliation_schema_pending")) {
      return NextResponse.json(
        { error: "Importação indisponível: migração da reconciliação pendente." },
        { status: 503 },
      );
    }
    console.error("[meta-reconciliation] backfill_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ error: "Não foi possível importar os leads." }, { status: 500 });
  }
}
