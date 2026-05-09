/**
 * GET /api/client/media/whatsapp/{tenantId}/{filename}
 * Proxy autenticado para mídia armazenada no Cloudflare R2.
 * O tenant só pode aceder a ficheiros cujo path começa com o seu tenant_id.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";

export const dynamic = "force-dynamic";

const EXT_TO_MIME: Record<string, string> = {
  ogg: "audio/ogg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  webm: "audio/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _req: Request,
  { params }: { params: { key: string[] } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const key = (params.key ?? []).join("/");
  if (!key) return NextResponse.json({ error: "key em falta" }, { status: 400 });

  // Segurança: path é whatsapp/{tenantId}/..., validamos que o tenantId bate
  const segments = key.split("/");
  const pathTenantId = segments[1] ?? "";
  if (pathTenantId !== session.tenantId) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  try {
    const buffer = await getMediaBufferFromR2(key);
    const ext = (key.split(".").pop() ?? "").toLowerCase();
    const contentType = EXT_TO_MIME[ext] ?? "application/octet-stream";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    console.error("[api/client/media] R2 download error", key, e);
    return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });
  }
}
