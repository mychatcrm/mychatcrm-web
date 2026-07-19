import { NextResponse } from "next/server";
import { validateCheckoutPhone } from "@/lib/checkout-phone";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { sendWhatsAppTextMessage } from "@/lib/integrations/whatsapp-cloud";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { resolveOrganizationRole } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

const TEST_MESSAGE = "Teste MyChatCRM — API Meta OK";

function friendlyMetaSendError(raw: string | undefined): string {
  const text = raw ?? "";
  if (text.includes("131047") || /outside.*allowed.*window/i.test(text)) {
    return "A Meta recusou o texto livre (código 131047): este número está fora da janela de 24h. Isso é esperado num contato “frio”. Lead Ads usa template aprovado; este teste só valida a conexão se o destinatário já falou consigo nas últimas 24h.";
  }
  if (text.includes("190") || /session has expired|invalid oauth/i.test(text)) {
    return "Token Meta expirado ou inválido. Desconecte e reconecte a API Meta em Integrações.";
  }
  if (!text.trim()) return "Falha ao enviar pela API Meta.";
  return text.slice(0, 400);
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const role = resolveOrganizationRole(session);
  if (role === "seller") {
    return NextResponse.json({ error: "Sem permissão para testar envio WhatsApp." }, { status: 403 });
  }

  let body: { slotIndex?: number; toNumber?: string } = {};
  try {
    body = (await request.json()) as { slotIndex?: number; toNumber?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const slotIndex = typeof body.slotIndex === "number" ? body.slotIndex : Number(body.slotIndex ?? 0);
  const extraWhatsappSlots = await getExtraWhatsappSlots(session.tenantId);
  if (!Number.isInteger(slotIndex) || !assertSlotIndexAllowed(session, slotIndex, extraWhatsappSlots)) {
    return NextResponse.json({ error: "slotIndex inválido" }, { status: 400 });
  }

  const phoneValidation = validateCheckoutPhone(body.toNumber ?? "");
  if (!phoneValidation.ok) {
    return NextResponse.json({ error: phoneValidation.message }, { status: 400 });
  }
  const toNumber = phoneValidation.phone;

  const conn = await getWhatsAppCloudConnection(session.tenantId, slotIndex);
  if (!conn?.active) {
    return NextResponse.json({ error: "API Meta não está conectada neste slot." }, { status: 409 });
  }
  const accessToken = conn.access_token?.trim() ?? "";
  if (!accessToken) {
    return NextResponse.json({ error: "Token da API Meta ausente. Reconecte o número." }, { status: 409 });
  }

  const sent = await sendWhatsAppTextMessage({
    toWaId: toNumber,
    text: TEST_MESSAGE,
    phoneNumberId: conn.phone_number_id,
    accessToken,
  });

  if (!sent.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: friendlyMetaSendError(sent.error),
        rawError: sent.error ?? null,
        status: sent.status,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    messageId: sent.messageId ?? null,
    message: TEST_MESSAGE,
  });
}
