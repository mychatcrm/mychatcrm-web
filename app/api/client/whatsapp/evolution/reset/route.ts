import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { isEvolutionApiConfigured } from "@/lib/integrations/evolution-api";
import { notifyTenantIntegrationDisconnected } from "@/lib/server/integration-disconnect-notifications";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import { removeEvolutionSlotSafely } from "@/lib/server/evolution-slot-lifecycle";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Removes only the remote Baileys session and keeps the slot row (same UUID)
 * so lead rules and authorized channels do not lose their logical connection.
 * The next explicit Connect creates a fresh Evolution instance in this slot.
 */
export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { slotIndex?: unknown };
  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex);
  const extraSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const row = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
  if (!row) {
    return NextResponse.json({ ok: true, reset: false, evolutionVerifiedAbsent: true });
  }

  const lifecycle = await removeEvolutionSlotSafely({
    tenantId: session.tenantId,
    slotIndex,
    mode: "resetting",
  });
  if (lifecycle.state === "pending") {
    console.warn("[evolution/reset] remote removal unverified", {
      tenant_id: session.tenantId,
      slot_index: slotIndex,
      instance_name: lifecycle.row.instance_name,
      presence: lifecycle.presence,
      error: lifecycle.error,
    });
    return NextResponse.json(
      {
        ok: true,
        operationPending: true,
        operation: lifecycle.operation,
        connectionState: lifecycle.operation,
        instanceName: lifecycle.row.instance_name,
        waJid: lifecycle.row.wa_jid,
        evolutionVerifiedAbsent: false,
        evolutionPresence: lifecycle.presence,
        evolutionError: lifecycle.error,
      },
      { status: 202 },
    );
  }
  if (lifecycle.state === "busy") {
    return NextResponse.json(
      {
        error: "Outra operação desta conexão ainda está em andamento.",
        operationPending: true,
        operation: lifecycle.operation,
        connectionState: lifecycle.row.connection_state,
        instanceName: lifecycle.row.instance_name,
      },
      { status: 409 },
    );
  }
  if (lifecycle.state === "missing") {
    return NextResponse.json({ ok: true, reset: false, evolutionVerifiedAbsent: true });
  }

  if (lifecycle.finalized) {
    try {
      await notifyTenantIntegrationDisconnected({
        tenantId: session.tenantId,
        integration: "whatsapp",
        source: "evolution_session_reset",
        sourceKey: lifecycle.previousInstanceName,
        instanceName: lifecycle.previousInstanceName,
        state: "reset",
        previousState: "open",
        manual: true,
        metadata: {
          slot_index: slotIndex,
          wa_jid: lifecycle.previousWaJid,
          logical_connection_id: lifecycle.row.id,
          next_instance_name: lifecycle.row.instance_name,
        },
      });
    } catch (error) {
      // A notification must not turn a confirmed reset into an ambiguous state.
      console.warn("[evolution/reset] disconnect notification failed", error);
    }
  }

  return NextResponse.json({
    ok: true,
    reset: true,
    operationComplete: true,
    operation: lifecycle.operation,
    evolutionVerifiedAbsent: true,
    connectionId: lifecycle.row.id,
    instanceName: lifecycle.row.instance_name,
    connectionState: "none",
  });
}
