import { NextResponse } from "next/server";
import { verifyMetaSignature256 } from "@/lib/integrations/whatsapp-cloud";
import { handleWhatsAppCloudWebhookPayload } from "@/lib/server/whatsapp-cloud-webhook-handler";

export const dynamic = "force-dynamic";

/** Verificação do webhook (Meta envia GET na subscrição). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Webhook WhatsApp Cloud API → mesma OPENAI_API_KEY central via generateAgentResponse.
 * O tenant é resolvido pelo phone_number_id explicitamente cadastrado na regra.
 */
export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const rawBody = await request.text();

  if (appSecret) {
    const sig = request.headers.get("x-hub-signature-256");
    if (!verifyMetaSignature256(rawBody, sig, appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let json: unknown;
  try {
    json = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: true });
  }

  return handleWhatsAppCloudWebhookPayload(json);
}
