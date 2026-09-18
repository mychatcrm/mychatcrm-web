/**
 * GET  /api/client/meta/reconciliation — última comparação e o que ficou de fora
 * POST /api/client/meta/reconciliation — roda uma nova comparação no período
 *
 * Só o titular dispara: a varredura consome quota da Graph API do cliente e
 * enxerga todos os formulários da conta, inclusive de equipes que um gerente
 * não alcança.
 */
// operational-audit: reconciled — runMetaLeadReconciliation regista cada execução.

import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import {
  RECONCILIATION_MAX_DAYS,
  loadLatestReconciliationRun,
  loadReconciliationGaps,
  runMetaLeadReconciliation,
} from "@/lib/server/meta-lead-reconciliation";
import { DEFAULT_CENTRAL_TIMEZONE, isValidTimezone } from "@/lib/meta-leads/central-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ERROR_MESSAGES: Record<string, { message: string; status: number }> = {
  reconciliation_schema_pending: {
    message:
      "Reconciliação indisponível: falta aplicar a migração 20260918001000_leads_central_reconciliation_v1.",
    status: 503,
  },
  reconciliation_already_running: {
    message: "Já existe uma reconciliação em curso para esta conta. Aguarde o fim.",
    status: 409,
  },
  reconciliation_no_connection: {
    message: "Nenhuma página Meta conectada. Conecte em Integrações → API Meta.",
    status: 422,
  },
  reconciliation_invalid_period: { message: "Período inválido.", status: 400 },
};

export async function GET(): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canSeeSpend } = guard;

  if (!canSeeSpend) {
    return NextResponse.json({ run: null, gaps: [], allowed: false });
  }

  try {
    const run = await loadLatestReconciliationRun(sb, session.tenantId);
    const gaps = run ? await loadReconciliationGaps(sb, session.tenantId, run.id) : [];
    return NextResponse.json({ run, gaps, allowed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[meta-reconciliation] read_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ run: null, gaps: [], allowed: true });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canSeeSpend } = guard;

  if (!canSeeSpend) {
    return NextResponse.json(
      { error: "Só o titular da conta pode rodar a reconciliação.", code: "FORBIDDEN_ROLE" },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    from?: unknown;
    to?: unknown;
    timezone?: unknown;
  };

  const from = typeof body.from === "string" && DAY_PATTERN.test(body.from) ? body.from : null;
  const to = typeof body.to === "string" && DAY_PATTERN.test(body.to) ? body.to : null;
  if (!from || !to || from > to) {
    return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });
  }

  // A Meta só devolve leads de formulário por uma janela limitada; pedir mais do
  // que isso gasta quota e devolve um resultado enganoso.
  const spanDays = Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
  if (spanDays > RECONCILIATION_MAX_DAYS) {
    return NextResponse.json(
      { error: `Período máximo de ${RECONCILIATION_MAX_DAYS} dias por reconciliação.` },
      { status: 422 },
    );
  }

  const timezone = isValidTimezone(body.timezone) ? body.timezone : DEFAULT_CENTRAL_TIMEZONE;

  try {
    const result = await runMetaLeadReconciliation({
      sb,
      tenantId: session.tenantId,
      from,
      to,
      timezone,
      startedBy: actorLabel(session),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const known = ERROR_MESSAGES[message.split(":")[0] ?? ""];
    if (known) return NextResponse.json({ error: known.message }, { status: known.status });
    console.error("[meta-reconciliation] run_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ error: "Não foi possível concluir a reconciliação." }, { status: 500 });
  }
}
