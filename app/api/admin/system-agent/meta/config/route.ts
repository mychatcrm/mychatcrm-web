import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { fetchWhatsAppMessageTemplateStatus } from "@/lib/integrations/whatsapp-cloud";
import {
  clearSystemAgentMetaConfig,
  getSystemAgentMetaConfig,
  saveSystemAgentMetaTemplate,
  setSystemActiveProvider,
} from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

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
      await saveSystemAgentMetaTemplate({ templateName: null, templateLang: null });
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
    });

    return NextResponse.json({
      ok: true,
      template_name: templateName,
      template_lang: templateLang || null,
      warning:
        check.status === "PENDING"
          ? `Template salvo, mas ainda está em análise pela Meta — os disparos vão falhar até ser aprovado.`
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

export async function DELETE() {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await clearSystemAgentMetaConfig();
  return NextResponse.json({ ok: true, active: false });
}
