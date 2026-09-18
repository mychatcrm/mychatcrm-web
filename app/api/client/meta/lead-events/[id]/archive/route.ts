/**
 * POST   /api/client/meta/lead-events/:id/archive — arquiva
 * DELETE /api/client/meta/lead-events/:id/archive — restaura
 *
 * Arquivar substitui o "Remover" antigo: o lead sai da lista padrão mas
 * continua no banco, no export e no filtro "Arquivados".
 */
// operational-audit: reconciled — setCentralEventsArchived regista arquivar/restaurar.

import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { setCentralEventsArchived } from "@/lib/server/meta-lead-central-actions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function apply(context: RouteContext, archived: boolean): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const { id } = await context.params;
  const eventId = id?.trim();
  if (!eventId) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const result = await setCentralEventsArchived({
    sb,
    tenantId: session.tenantId,
    eventIds: [eventId],
    archived,
    actorId: actorLabel(session),
    scope,
  });

  if (!result.ok) {
    const status = result.code === "schema_pending" ? 503 : result.code === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, archived });
}

export async function POST(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return apply(context, true);
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return apply(context, false);
}
