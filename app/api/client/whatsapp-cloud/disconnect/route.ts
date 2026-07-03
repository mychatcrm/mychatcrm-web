import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { deleteWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";

export const dynamic = "force-dynamic";

export async function DELETE(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  await deleteWhatsAppCloudConnection(session.tenantId);
  return NextResponse.json({ ok: true });
}
