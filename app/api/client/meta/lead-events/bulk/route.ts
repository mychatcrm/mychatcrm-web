/**
 * POST /api/client/meta/lead-events/bulk
 *
 * Ações em massa da Central: arquivar e restaurar. Cada id é validado contra o
 * recorte de acesso antes de ser tocado — ação em lote não pode virar a porta
 * dos fundos para mexer em lead de outra equipe.
 */
// operational-audit: reconciled — setCentralEventsArchived regista a ação em lote.

import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { setCentralEventsArchived } from "@/lib/server/meta-lead-central-actions";

export const dynamic = "force-dynamic";

const MAX_IDS = 500;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; ids?: unknown };
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (action !== "archive" && action !== "restore") {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? Array.from(
        new Set(
          body.ids
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0 && value.length <= 64),
        ),
      ).slice(0, MAX_IDS)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um lead." }, { status: 400 });
  }

  const result = await setCentralEventsArchived({
    sb,
    tenantId: session.tenantId,
    eventIds: ids,
    archived: action === "archive",
    actorId: actorLabel(session),
    scope,
  });

  if (!result.ok) {
    const status = result.code === "schema_pending" ? 503 : result.code === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, updated: result.updated });
}
