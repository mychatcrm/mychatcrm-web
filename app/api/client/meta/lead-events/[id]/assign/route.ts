import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { loadCentralEventInScope } from "@/lib/server/meta-lead-central-actions";
import { assignMetaLeadEventToAgent, assignMetaLeadEventToEmployee } from "@/lib/server/meta-lead-manual-assignment";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type AssignBody =
  | { target: "agent"; agentId: string }
  | { target: "employee"; employeeId: string };

/** Direciona manualmente um lead em erro de meta_lead_events para um agente de IA ou atendente humano. */
export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const { id } = await context.params;
  const eventId = id?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Redirecionar um lead é uma escrita: o recorte de acesso vale aqui tanto
  // quanto na leitura, senão sabe-se o id e mexe-se no lead de outra equipe.
  const inScope = await loadCentralEventInScope(sb, session.tenantId, eventId, scope);
  if (!inScope) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }

  let body: AssignBody;
  try {
    body = (await req.json()) as AssignBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const result =
    body.target === "agent"
      ? await assignMetaLeadEventToAgent({
          sb,
          tenantId: session.tenantId,
          eventId,
          agentId: typeof body.agentId === "string" ? body.agentId : "",
        })
      : body.target === "employee"
        ? await assignMetaLeadEventToEmployee({
            sb,
            tenantId: session.tenantId,
            eventId,
            employeeId: typeof body.employeeId === "string" ? body.employeeId : "",
          })
        : ({ ok: false, error: "target inválido", status: 400 } as const);

  if (!result.ok) {
    console.warn("[meta-lead-events] manual_assignment_failed", {
      tenant_id: session.tenantId,
      event_id: eventId,
      target: body.target,
      error: result.error,
    });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  console.info("[meta-lead-events] manual_assignment_success", {
    tenant_id: session.tenantId,
    event_id: eventId,
    target: body.target,
  });

  // Redirecionar um lead troca quem o atende: fica na auditoria como qualquer
  // outra mudança de responsável.
  void appendOperationalAuditEvent({
    tenantId: session.tenantId,
    actorType: "customer",
    actorId: actorLabel(session),
    module: "leads.central",
    action: "lead_event.reassigned",
    resourceType: "meta_lead_events",
    resourceId: eventId,
    status: "completed",
    severity: "info",
    integration: "meta_lead_ads",
    metadata: { target: body.target },
  });

  return NextResponse.json({ ok: true, event: result.event });
}
