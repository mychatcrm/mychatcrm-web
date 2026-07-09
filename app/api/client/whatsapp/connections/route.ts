/**
 * GET /api/client/whatsapp/connections
 * Lista as linhas de WhatsApp (QR Code + API Meta) do tenant — usado pelo
 * filtro por número em /dashboard/conversas e pela tela /dashboard/integracoes.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { listTenantWhatsappConnections } from "@/lib/server/tenant-whatsapp-connections";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const connections = await listTenantWhatsappConnections(session.tenantId);
  return NextResponse.json({ connections }, { headers: { "Cache-Control": "no-store" } });
}
