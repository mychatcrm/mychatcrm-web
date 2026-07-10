import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { buildFreshEvolutionInstanceName, evolutionRemoveInstanceCompletely, isEvolutionApiConfigured } from "@/lib/integrations/evolution-api";
import { notifyTenantIntegrationDisconnected } from "@/lib/server/integration-disconnect-notifications";
import { getEvolutionInstanceByTenantSlot, upsertTenantEvolutionInstance } from "@/lib/server/tenant-evolution-instance-db";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";

export const dynamic = "force-dynamic";

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

  const removal = await evolutionRemoveInstanceCompletely(row.instance_name);
  if (!removal.verifiedAbsent) {
    console.warn("[evolution/reset] remote removal unverified", {
      tenant_id: session.tenantId,
      slot_index: slotIndex,
      instance_name: row.instance_name,
      presence: removal.presence,
      error: removal.error,
    });
    return NextResponse.json(
      {
        error: "Não foi possível confirmar a exclusão da sessão na Evolution. A conexão foi mantida para evitar perda de configuração.",
        evolutionVerifiedAbsent: false,
      },
      { status: 502 },
    );
  }

  const freshInstanceName = buildFreshEvolutionInstanceName(session.tenantId, slotIndex);
  const preserved = await upsertTenantEvolutionInstance({
    tenantId: session.tenantId,
    slotIndex,
    instanceName: freshInstanceName,
    connectionState: "close",
    waJid: null,
    defaultAgentId: row.default_agent_id,
  });

  try {
    await notifyTenantIntegrationDisconnected({
      tenantId: session.tenantId,
      integration: "whatsapp",
      source: "evolution_session_reset",
      sourceKey: row.instance_name,
      instanceName: row.instance_name,
      state: "reset",
      previousState: row.connection_state,
      manual: true,
      metadata: {
        slot_index: slotIndex,
        wa_jid: row.wa_jid,
        logical_connection_id: preserved.id,
        next_instance_name: freshInstanceName,
      },
    });
  } catch (error) {
    // A notification must not turn a confirmed reset into an ambiguous state.
    console.warn("[evolution/reset] disconnect notification failed", error);
  }

  return NextResponse.json({
    ok: true,
    reset: true,
    evolutionVerifiedAbsent: true,
    connectionId: preserved.id,
    instanceName: freshInstanceName,
    connectionState: "none",
  });
}
