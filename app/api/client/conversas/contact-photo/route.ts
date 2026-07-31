/**
 * GET /api/client/conversas/contact-photo?jid={remoteJid}
 *
 * Dois modos de operação determinados pelo Accept header:
 *  - Accept: image/*  → faz proxy da imagem do CDN WhatsApp e serve os bytes
 *  - Outro           → retorna JSON { photoUrl: string | null }
 *
 * A URL do CDN WhatsApp é buscada na Evolution API (POST /chat/fetchProfilePictureUrl).
 * Credenciais da Evolution API ficam no servidor — nunca expostas ao cliente.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { getEvolutionInstanceByTenantId } from "@/lib/server/tenant-evolution-instance-db";
import { fetchContactPhoto } from "@/lib/integrations/evolution-api";

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


  // Busca a instância Evolution do tenant
  let instanceName: string | null = null;
  try {
    const row = await getEvolutionInstanceByTenantId(session.tenantId);
    instanceName = row?.instance_name ?? null;
  } catch {
    console.warn("[contact-photo] falha ao buscar instância", session.tenantId);
  }

  if (!instanceName) {
    console.warn("[contact-photo] instância não encontrada para tenant", session.tenantId);
    return NextResponse.json({ photoUrl: null });
  }

  let photoUrl: string | null = null;
  try {
    photoUrl = await fetchContactPhoto(instanceName, jid);
  } catch (e) {
    console.warn("[contact-photo] fetchContactPhoto exception", e);
  }

  if (!photoUrl) {
    return NextResponse.json({ photoUrl: null });
  }

  // Modo proxy: se o cliente pede imagem, buscar e servir os bytes server-side
  // evita problemas de CORS e expiração de URL no browser.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("image/")) {
    try {
      const imgRes = await fetch(photoUrl, {
        headers: { "User-Agent": "WhatsApp/2.24.1 A" },
        signal: AbortSignal.timeout(8_000),
      });
      if (imgRes.ok) {
        const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
        const buf = await imgRes.arrayBuffer();
        return new Response(buf, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      console.warn("[contact-photo] proxy fetch non-ok", imgRes.status, photoUrl.slice(0, 80));
    } catch (e) {
      console.warn("[contact-photo] proxy fetch error", e);
    }
    // fallback: retornar sem imagem
    return new Response(null, { status: 404 });
  }

  // Modo JSON: retorna URL para o cliente carregar directamente
  return NextResponse.json({ photoUrl });
}
