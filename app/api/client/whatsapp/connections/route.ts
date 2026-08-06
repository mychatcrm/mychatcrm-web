/**
 * GET /api/client/whatsapp/connections
 * Lista as linhas de WhatsApp (QR Code + API Meta) do tenant — usado pelo
 * filtro por número em /dashboard/conversas e pela tela /dashboard/integracoes.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { listTenantWhatsappConnections } from "@/lib/server/tenant-whatsapp-connections";
import { getSlotPurposesForTenant } from "@/lib/server/whatsapp-slot-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const [connections, purposeBySlot] = await Promise.all([
    listTenantWhatsappConnections(session.tenantId),
    getSlotPurposesForTenant(session.tenantId),
  ]);

  // `purposes` vai separado de `connections` de propósito: uma linha ainda sem
  // número pareado não aparece na lista de conexões, mas já pode ter finalidade.
  return NextResponse.json(
    { connections, purposes: Object.fromEntries(purposeBySlot) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
