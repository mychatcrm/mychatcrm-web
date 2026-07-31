/**
 * GET /api/client/conversas/contact-name?jid={remoteJid}
 * Busca o nome/pushName de um contato WhatsApp via Evolution API.
 * Retorna JSON { name: string | null }
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { fetchContactName } from "@/lib/integrations/evolution-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jid = searchParams.get("jid");
  if (!jid) return NextResponse.json({ error: "jid em falta" }, { status: 400 });

  const sbScope = createSupabaseServiceClient();
  if (!(await conversationInScope(sbScope, session.tenantId, jid, await resolveAccessScope(sbScope, session)))) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }


  let instanceName: string | null = null;
  try {
    const row = await getEvolutionInstanceByTenantId(session.tenantId);
    instanceName = row?.instance_name ?? null;
  } catch {
    console.warn("[contact-name] falha ao buscar instância", session.tenantId);
  }

  if (!instanceName) {
    return NextResponse.json({ name: null });
  }

  try {
    const name = await fetchContactName(instanceName, jid);
    return NextResponse.json({ name });
  } catch (e) {
    console.warn("[contact-name] exception", e);
    return NextResponse.json({ name: null });
  }
}
