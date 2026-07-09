import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";

export const dynamic = "force-dynamic";

export type WhatsAppCloudStatusResponse =
  | { connected: false }
  | { connected: true; phone_number_id: string; display_phone: string | null; verified_name: string | null };

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const slotIndexRaw = new URL(request.url).searchParams.get("slotIndex");
  const slotIndex = slotIndexRaw !== null ? Number(slotIndexRaw) : 0;
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const conn = await getWhatsAppCloudConnection(session.tenantId, slotIndex);
  if (!conn) {
    return NextResponse.json<WhatsAppCloudStatusResponse>({ connected: false });
  }

  return NextResponse.json<WhatsAppCloudStatusResponse>({
    connected: true,
    phone_number_id: conn.phone_number_id,
    display_phone: conn.display_phone,
    verified_name: conn.verified_name,
  });
}
