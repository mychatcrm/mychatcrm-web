/**
 * GET /api/client/whatsapp-campaigns/meta-templates?connectionId=
 * Lista os templates aprovados da WABA da linha API Meta escolhida — usado
 * pelo seletor de mensagem de Disparos quando a linha é API Meta (mensagem
 * business-initiated fora da janela de 24h precisa de template aprovado).
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { listWhatsAppMessageTemplates } from "@/lib/integrations/whatsapp-cloud";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const connectionId = new URL(request.url).searchParams.get("connectionId")?.trim();
  if (!connectionId) return NextResponse.json({ error: "connectionId é obrigatório" }, { status: 400 });

  const connection = await lookupWhatsAppCloudConnectionByPhoneNumberId(connectionId);
  if (!connection || connection.tenant_id !== guard.session.tenantId || !connection.waba_id) {
    return NextResponse.json({ error: "Conexão API Meta não encontrada." }, { status: 404 });
  }

  const templates = await listWhatsAppMessageTemplates({
    wabaId: connection.waba_id,
    accessToken: connection.access_token,
  });
  return NextResponse.json(
    { templates: templates.filter((t) => t.status === "APPROVED") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
