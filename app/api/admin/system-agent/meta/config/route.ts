import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  createWhatsAppMessageTemplate,
  fetchWhatsAppMessageTemplateStatus,
} from "@/lib/integrations/whatsapp-cloud";
import {
  clearSystemAgentMetaConfig,
  getSystemAgentMetaConfig,
  saveSystemAgentMetaTemplate,
  setSystemActiveProvider,
} from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";
const SYSTEM_NOTIFICATION_TEMPLATE_NAME = "mychatcrm_agenda_notification_v1";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getSystemAgentMetaConfig();
  if (!config) {
    return NextResponse.json({ active: false, phone_number_id: null, display_phone: null, verified_name: null });
  }

  return NextResponse.json({
    active: config.active,
    phone_number_id: config.phoneNumberId,
    display_phone: config.displayPhone,
    verified_name: config.verifiedName,
    access_token: "•••••",
    webhook_subscribed: config.webhookSubscribed,
    phone_registered: config.phoneRegistered,
    template_name: config.templateName,
    template_lang: config.templateLang,
    template_status: config.templateStatus,
  });
}

/**
 * PATCH multiuso:
 * - { active_provider: "evolution" | "meta" } — alterna qual provedor atende sem apagar credenciais
 *   (trocar para "meta" exige credenciais Meta já salvas);
 * - { template_name, template_lang } — salva o template aprovado usado para mensagens iniciadas
 *   pela empresa fora da janela de 24h (string vazia limpa).
 */
export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    active_provider?: string;
    template_name?: string;
    template_lang?: string;
  };

  if (body.template_name !== undefined || body.template_lang !== undefined) {
    const templateName = typeof body.template_name === "string" ? body.template_name.trim() : "";
    const templateLang = typeof body.template_lang === "string" ? body.template_lang.trim() : "";

    // Limpar o template (nome vazio) não precisa de validação contra a Meta.
    if (!templateName) {
      await saveSystemAgentMetaTemplate({
        templateName: null,
        templateLang: null,
        templateStatus: null,
      });
      return NextResponse.json({ ok: true, template_name: null, template_lang: null });
    }

    const config = await getSystemAgentMetaConfig();
    if (!config?.wabaId) {
      return NextResponse.json(
        {
          error:
            "Não temos o ID da conta WhatsApp Business (WABA) salvo para validar o template — desconecte e reconecte via «Conectar via Facebook» primeiro.",
        },
        { status: 422 },
      );
    }

    const check = await fetchWhatsAppMessageTemplateStatus({
      wabaId: config.wabaId,
      templateName,
      accessToken: config.accessToken,
    });

    if (!check.found) {
      return NextResponse.json(
        { error: `Template «${templateName}» não existe nessa conta WhatsApp Business — confira o nome exato no gerenciador do WhatsApp.` },
        { status: 400 },
      );
    }
    if (check.status === "REJECTED") {
      return NextResponse.json(
        { error: `Template «${templateName}» foi rejeitado pela Meta — crie outro ou corrija o conteúdo/categoria.` },
        { status: 400 },
      );
    }

    await saveSystemAgentMetaTemplate({
      templateName,
      templateLang: templateLang || null,
      templateStatus: check.status,
    });

    return NextResponse.json({
      ok: true,
      template_name: templateName,
      template_lang: templateLang || null,
      template_status: check.status,
      warning:
        check.status === "PENDING"
          ? `Template salvo e em análise pela Meta — as notificações ficarão na fila até a aprovação.`
          : null,
    });
  }

  const provider = body.active_provider;
  if (provider !== "evolution" && provider !== "meta") {
    return NextResponse.json({ error: "active_provider deve ser 'evolution' ou 'meta'" }, { status: 400 });
  }

  if (provider === "meta") {
    const config = await getSystemAgentMetaConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Conecte as credenciais da API Meta antes de ativá-la." },
        { status: 422 },
      );
    }
  }

  await setSystemActiveProvider(provider);
  return NextResponse.json({ ok: true, active_provider: provider });
}

export async function POST() {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getSystemAgentMetaConfig();
  if (!config?.wabaId) {
    return NextResponse.json({ error: "Conexão Meta sem WABA configurada." }, { status: 422 });
  }

  const existing = await fetchWhatsAppMessageTemplateStatus({
    wabaId: config.wabaId,
    templateName: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
    accessToken: config.accessToken,
  });
  if (existing.found && existing.status === "REJECTED") {
    return NextResponse.json(
      { error: `O template «${SYSTEM_NOTIFICATION_TEMPLATE_NAME}» foi rejeitado pela Meta.` },
      { status: 409 },
    );
  }
  if (existing.found && existing.status) {
    await saveSystemAgentMetaTemplate({
      templateName: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
      templateLang: "pt_BR",
      templateStatus: existing.status,
    });
    return NextResponse.json({
      ok: true,
      template_name: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
      template_lang: "pt_BR",
      template_status: existing.status,
      created: false,
    });
  }

  const created = await createWhatsAppMessageTemplate({
    wabaId: config.wabaId,
    accessToken: config.accessToken,
    templateName: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
    languageCode: "pt_BR",
  });
  if (!created.ok) {
    return NextResponse.json(
      { error: created.error ?? "Falha ao criar template na Meta." },
      { status: created.status >= 400 && created.status < 600 ? created.status : 502 },
    );
  }
  await saveSystemAgentMetaTemplate({
    templateName: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
    templateLang: "pt_BR",
    templateStatus: created.templateStatus ?? "PENDING",
  });
  return NextResponse.json({
    ok: true,
    template_name: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
    template_lang: "pt_BR",
    template_status: created.templateStatus ?? "PENDING",
    created: true,
  });
}

export async function DELETE() {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await clearSystemAgentMetaConfig();
  return NextResponse.json({ ok: true, active: false });
}
