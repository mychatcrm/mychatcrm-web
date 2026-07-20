import { NextResponse } from "next/server";
import { validateCheckoutPhone } from "@/lib/checkout-phone";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import {
  checkWhatsAppCloudConnectionHealth,
  classifyWhatsAppCloudSendError,
  listWhatsAppMessageTemplates,
  sendWhatsAppTemplateMessage,
  sendWhatsAppTextMessage,
  type WhatsAppCloudTemplate,
} from "@/lib/integrations/whatsapp-cloud";
import { getWhatsAppCloudConnection } from "@/lib/server/whatsapp-cloud-connections";
import { assertSlotIndexAllowed } from "@/lib/server/whatsapp-slot-server";
import { getExtraWhatsappSlots } from "@/lib/server/whatsapp-extra-slots-db";
import { resolveOrganizationRole } from "@/lib/organization-role";

export const dynamic = "force-dynamic";

const TEST_MESSAGE = "Teste MyChatCRM — API Meta OK";
const MAX_TEMPLATE_OPTIONS = 20;

type TestSendErrorCode = "invalid_token" | "outside_24h_window" | "other";

function friendlyMetaSendError(raw: string | undefined): string {
  const text = raw ?? "";
  if (text.includes("131047") || /outside.*allowed.*window/i.test(text)) {
    return "A Meta recusou o texto livre (código 131047): este número está fora da janela de 24h. Isso é esperado num contato “frio”.";
  }
  if (text.includes("190") || /session has expired|invalid oauth/i.test(text)) {
    return "Token Meta expirado ou inválido. Desconecte e reconecte a API Meta em Integrações.";
  }
  if (!text.trim()) return "Falha ao enviar pela API Meta.";
  return text.slice(0, 400);
}

function templateOption(template: WhatsAppCloudTemplate) {
  return {
    name: template.name,
    language: template.language,
    bodyParamCount: template.bodyParamCount,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const role = resolveOrganizationRole(session);
  if (role === "seller") {
    return NextResponse.json({ error: "Sem permissão para testar envio WhatsApp." }, { status: 403 });
  }

  let body: { slotIndex?: number; toNumber?: string; templateName?: string } = {};
  try {
    body = (await request.json()) as { slotIndex?: number; toNumber?: string; templateName?: string };
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
  const templateName = body.templateName?.trim() || null;

  const conn = await getWhatsAppCloudConnection(session.tenantId, slotIndex);
  if (!conn?.active) {
    return NextResponse.json({ error: "API Meta não está conectada neste slot." }, { status: 409 });
  }
  const accessToken = conn.access_token?.trim() ?? "";
  if (!accessToken) {
    return NextResponse.json({ error: "Token da API Meta ausente. Reconecte o número." }, { status: 409 });
  }

  // Diagnóstico somente-leitura antes de gastar uma tentativa de envio. Um
  // token realmente morto (ex.: sobra do fallback silencioso de
  // exchange-code para o token de curta duração) dá um resultado
  // determinístico aqui em vez de um erro genérico do envio.
  const health = await checkWhatsAppCloudConnectionHealth({
    phoneNumberId: conn.phone_number_id,
    accessToken,
  });
  if (!health.ok && health.code === "invalid_token") {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_token" satisfies TestSendErrorCode,
        error: "Token da API Meta inválido ou expirado. Desconecte e reconecte o número.",
        rawError: health.error,
      },
      { status: 409 },
    );
  }

  // Envio explícito via template escolhido pelo usuário (fallback quando o
  // texto livre é recusado por estar fora da janela de 24h — 131047).
  if (templateName) {
    if (!conn.waba_id) {
      return NextResponse.json({ error: "Conexão sem WABA associada — não é possível listar templates." }, { status: 409 });
    }
    const templates = await listWhatsAppMessageTemplates({ wabaId: conn.waba_id, accessToken });
    const template = templates.find((t) => t.name === templateName && t.status === "APPROVED");
    if (!template) {
      return NextResponse.json({ error: "Template não encontrado ou não aprovado." }, { status: 400 });
    }
    if (template.bodyParamCount > 1) {
      return NextResponse.json(
        { error: "Este template exige mais de 1 parâmetro no corpo — não suportado para o teste automático." },
        { status: 400 },
      );
    }
    const bodyParams = template.bodyParamCount === 1 ? [TEST_MESSAGE] : undefined;
    const sent = await sendWhatsAppTemplateMessage({
      toWaId: toNumber,
      templateName: template.name,
      languageCode: template.language || "pt_BR",
      bodyParams,
      phoneNumberId: conn.phone_number_id,
      accessToken,
    });
    if (!sent.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: classifyWhatsAppCloudSendError(sent.error) satisfies TestSendErrorCode,
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
      message: `Template "${template.name}" enviado com sucesso.`,
    });
  }

  // Caminho padrão: texto livre (mais rápido de validar quando o destinatário
  // já falou com o número nas últimas 24h).
  const sent = await sendWhatsAppTextMessage({
    toWaId: toNumber,
    text: TEST_MESSAGE,
    phoneNumberId: conn.phone_number_id,
    accessToken,
  });

  if (!sent.ok) {
    const code = classifyWhatsAppCloudSendError(sent.error);
    let availableTemplates: ReturnType<typeof templateOption>[] | undefined;
    if (code === "outside_24h_window" && conn.waba_id) {
      const templates = await listWhatsAppMessageTemplates({ wabaId: conn.waba_id, accessToken });
      availableTemplates = templates
        .filter((t) => t.status === "APPROVED")
        .slice(0, MAX_TEMPLATE_OPTIONS)
        .map(templateOption);
    }
    return NextResponse.json(
      {
        ok: false,
        code: code satisfies TestSendErrorCode,
        error: friendlyMetaSendError(sent.error),
        rawError: sent.error ?? null,
        status: sent.status,
        ...(availableTemplates ? { availableTemplates } : {}),
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
