/**
 * GET /api/client/conversas/contact-photo?jid={remoteJid}
 * Busca a foto de perfil de um contato WhatsApp via Evolution API.
 * Credenciais da Evolution API ficam no servidor — nunca expostas ao cliente.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { fetchContactPhoto } from "@/lib/integrations/evolution-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jid = searchParams.get("jid");
  if (!jid) return NextResponse.json({ error: "jid em falta" }, { status: 400 });

  // Busca a instância Evolution do tenant
  let instanceName: string | null = null;
  try {
    const row = await getEvolutionInstanceByTenantId(session.tenantId);
    instanceName = row?.instance_name ?? null;
  } catch {
    // silencioso — retorna null abaixo
  }

  if (!instanceName) {
    return NextResponse.json({ photoUrl: null });
  }

  try {
    const photoUrl = await fetchContactPhoto(instanceName, jid);
    return NextResponse.json({ photoUrl });
  } catch {
    return NextResponse.json({ photoUrl: null });
  }
}
