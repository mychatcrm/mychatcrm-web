/**
 * PATCH /api/client/whatsapp/slot-provider
 * Troca qual método (QR/Evolution ou API Meta) responde por uma linha do
 * tenant, sem desconectar nenhum dos dois lados. Só permitido quando o lado
 * de destino já está de facto conectado — não existe "migrar sem nunca ter
 * conectado o outro lado antes".
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { setSlotActiveProvider, type SlotProvider } from "@/lib/server/whatsapp-slot-provider";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = (await request.json().catch(() => ({}))) as { slotIndex?: number; provider?: string };
  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex);
  const provider = body.provider;

  if (provider !== "evolution" && provider !== "cloud_api") {
    return NextResponse.json({ error: "provider inválido" }, { status: 400 });
  }

  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  // O lado de destino precisa já estar conectado — o alternador nunca é a
  // primeira forma de ligar um método.
  if (provider === "evolution") {
    const evoRow = await getEvolutionInstanceByTenantSlot(session.tenantId, slotIndex);
    if (evoRow?.connection_state !== "open") {
      return NextResponse.json({ error: "QR Code desta linha não está conectado." }, { status: 409 });
    }
  } else {
    const cloudRow = await getWhatsAppCloudConnection(session.tenantId, slotIndex);
    if (!cloudRow?.active) {
      return NextResponse.json({ error: "API Meta desta linha não está conectada." }, { status: 409 });
    }
  }

  await setSlotActiveProvider(session.tenantId, slotIndex, provider as SlotProvider);
  return NextResponse.json({ ok: true, activeProvider: provider });
}
