import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getSystemAgentMetaConfig, saveSystemAgentMetaOnboardingFlags } from "@/lib/server/system-agent";
import { registerWhatsAppCloudNumber, subscribeAppToWaba } from "@/lib/server/whatsapp-cloud-onboarding";

export const dynamic = "force-dynamic";

/**
 * Reexecuta os passos de onboarding da Cloud API (subscribed_apps + register)
 * com as credenciais já salvas — a ferramenta de manutenção do canal Meta,
 * equivalente ao "Re-aplicar webhook" da Evolution.
 */
export async function POST(): Promise<NextResponse> {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getSystemAgentMetaConfig();
  if (!config) {
    return NextResponse.json({ error: "Nenhuma conexão Meta salva — conecte primeiro." }, { status: 422 });
  }

  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    return NextResponse.json({ error: "META_APP_SECRET não configurado no servidor." }, { status: 503 });
  }

  const webhookSubscribed = config.wabaId
    ? await subscribeAppToWaba({ wabaId: config.wabaId, accessToken: config.accessToken, logPrefix: "admin/meta-repair" })
    : false;

  const phoneRegistered = await registerWhatsAppCloudNumber({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    appSecret,
    logPrefix: "admin/meta-repair",
  });

  await saveSystemAgentMetaOnboardingFlags({ webhookSubscribed, phoneRegistered });

  return NextResponse.json({
    ok: webhookSubscribed && phoneRegistered,
    webhook_subscribed: webhookSubscribed,
    phone_registered: phoneRegistered,
    waba_id_known: Boolean(config.wabaId),
  });
}
