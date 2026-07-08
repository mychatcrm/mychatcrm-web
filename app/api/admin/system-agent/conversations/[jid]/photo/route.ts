/**
 * GET /api/admin/system-agent/conversations/[jid]/photo
 *
 * Proxy da foto de perfil do WhatsApp para o painel "Conversas ao vivo".
 * Só é possível via Evolution/Baileys — a API Oficial Meta não expõe foto de
 * perfil de contatos por política da plataforma, então contatos que só
 * falaram pelo número Meta nunca terão foto aqui (o painel mostra um ícone
 * genérico nesse caso). Se o agente do sistema não tiver uma instância
 * Evolution registada, ou o contato não tiver foto pública, retorna 404.
 */
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { fetchContactPhoto } from "@/lib/integrations/evolution-api";
import { getEvolutionInstanceByTenantSlot } from "@/lib/server/tenant-evolution-instance-db";
import { SYSTEM_SLOT_INDEX, SYSTEM_TENANT_ID } from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { jid: string } }) {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const remoteJid = decodeURIComponent(params.jid);
  if (!remoteJid) return NextResponse.json({ error: "jid em falta" }, { status: 400 });

  let instanceName: string | null = null;
  try {
    const row = await getEvolutionInstanceByTenantSlot(SYSTEM_TENANT_ID, SYSTEM_SLOT_INDEX);
    instanceName = row?.instance_name ?? null;
  } catch (e) {
    console.warn("[system-agent/photo] instance lookup failed", e);
  }

  if (!instanceName) {
    return new Response(null, { status: 404 });
  }

  let photoUrl: string | null = null;
  try {
    photoUrl = await fetchContactPhoto(instanceName, remoteJid);
  } catch (e) {
    console.warn("[system-agent/photo] fetchContactPhoto failed", e);
  }

  if (!photoUrl) {
    return new Response(null, { status: 404 });
  }

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
    console.warn("[system-agent/photo] proxy fetch non-ok", imgRes.status);
  } catch (e) {
    console.warn("[system-agent/photo] proxy fetch error", e);
  }

  return new Response(null, { status: 404 });
}
