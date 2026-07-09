import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { deleteWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const slotIndexRaw = new URL(request.url).searchParams.get("slotIndex");
  const slotIndex = slotIndexRaw !== null ? Number(slotIndexRaw) : 0;
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  await deleteWhatsAppCloudConnection(session.tenantId, slotIndex);
  return NextResponse.json({ ok: true });
}
