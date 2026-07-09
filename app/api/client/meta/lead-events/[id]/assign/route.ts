import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { assignMetaLeadEventToAgent, assignMetaLeadEventToEmployee } from "@/lib/server/meta-lead-manual-assignment";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type AssignBody =
  | { target: "agent"; agentId: string }
  | { target: "employee"; employeeId: string };

/** Direciona manualmente um lead em erro de meta_lead_events para um agente de IA ou atendente humano. */
export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { id } = await context.params;
  const eventId = id?.trim();
  if (!eventId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let body: AssignBody;
  try {
    body = (await req.json()) as AssignBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();

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
  return NextResponse.json({ ok: true, event: result.event });
}
