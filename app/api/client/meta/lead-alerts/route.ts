/**
 * GET   /api/client/meta/lead-alerts — alertas abertos (detecta na hora se pedido)
 * PATCH /api/client/meta/lead-alerts — marca um alerta como visto
 */
import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import {
  acknowledgeMetaLeadAlert,
  detectAndStoreMetaLeadAlerts,
  loadOpenMetaLeadAlerts,
} from "@/lib/server/meta-lead-alerts";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  try {
    // `detect=1` recalcula antes de listar; a Central pede isso ao abrir, e o
    // índice único por assinatura impede que o mesmo problema vire vários avisos.
    if (req.nextUrl.searchParams.get("detect") === "1") {
      await detectAndStoreMetaLeadAlerts({ sb, tenantId: session.tenantId });
    }
    const alerts = await loadOpenMetaLeadAlerts(sb, session.tenantId);
    return NextResponse.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[meta-lead-alerts] read_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ alerts: [] });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const body = (await req.json().catch(() => ({}))) as { alertId?: unknown };
  const alertId = typeof body.alertId === "string" ? body.alertId.trim() : "";
  if (!alertId) return NextResponse.json({ error: "alertId obrigatório." }, { status: 400 });

  const ok = await acknowledgeMetaLeadAlert({
    sb,
    tenantId: session.tenantId,
    alertId,
    actorId: actorLabel(session),
  });
  if (!ok) {
    return NextResponse.json({ error: "Não foi possível atualizar o alerta." }, { status: 500 });
  }

  await appendOperationalAuditEvent({
    tenantId: session.tenantId,
    actorType: "customer",
    actorId: actorLabel(session),
    module: "leads.central",
    action: "alert.acknowledged",
    resourceType: "meta_lead_alerts",
    resourceId: alertId,
    status: "completed",
    severity: "info",
    integration: "meta_lead_ads",
  });

  return NextResponse.json({ ok: true });
}
