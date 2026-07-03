import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";

export const dynamic = "force-dynamic";

export type WhatsAppCloudStatusResponse =
  | { connected: false }
  | { connected: true; phone_number_id: string; display_phone: string | null; verified_name: string | null };

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const conn = await getWhatsAppCloudConnection(session.tenantId);
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
