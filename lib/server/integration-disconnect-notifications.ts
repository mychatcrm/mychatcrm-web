import "server-only";

import { jidToDigits } from "@/lib/integrations/evolution-api";
import { SYSTEM_TENANT_ID, sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const INTEGRATION_DISCONNECTED_TYPE = "integration_disconnected";
const INTEGRATION_CONNECTED_TYPE = "integration_connected";
type NotificationKind = typeof INTEGRATION_DISCONNECTED_TYPE | typeof INTEGRATION_CONNECTED_TYPE;
const DEDUPE_WINDOW_MS = 4 * 60 * 60 * 1000;
const STABLE_DISCONNECT_STATES = new Set(["close", "refused", "deleted", "logout"]);

export type IntegrationDisconnectKind = "whatsapp" | "facebook";

export function normalizeConnectionState(state: string | null | undefined): string {
  return (state ?? "").trim().toLowerCase();
}

export function isDisconnectedConnectionState(state: string | null | undefined): boolean {
  const normalized = normalizeConnectionState(state);
  return Boolean(normalized) && normalized !== "open";
}

export function isStableDisconnectState(state: string | null | undefined): boolean {
  return STABLE_DISCONNECT_STATES.has(normalizeConnectionState(state));
}

export function shouldNotifyWhatsappDisconnect(params: {
  previousState?: string | null;
  nextState?: string | null;
}): boolean {
  return (
    normalizeConnectionState(params.previousState) === "open" && isStableDisconnectState(params.nextState)
  );
}

/** Espelho invertido: só true numa transição real para conectado, não numa reconfirmação. */
export function shouldNotifyWhatsappConnect(params: {
  previousState?: string | null;
  nextState?: string | null;
}): boolean {
  return (
    normalizeConnectionState(params.previousState) !== "open" &&
    normalizeConnectionState(params.nextState) === "open"
  );
}

function maskPhoneLast4(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function safeText(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").trim();
  return text || fallback;
}

export async function loadTenantNotificationRecipient(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
}): Promise<{
  phone: string | null;
  tenantName: string | null;
  ownerName: string | null;
  source:
    | "tenant_system_notification_phone"
    | "owner_member_phone"
    | "owner_email_member_phone"
    | "director_member_phone"
    | "missing";
}> {
  const [{ data: tenant }, { data: provision }] = await Promise.all([
    params.sb
      .from("tenants")
      .select("name, system_notification_phone")
      .eq("id", params.tenantId)
      .maybeSingle(),
    params.sb
      .from("enterprise_provisions")
      .select("owner_member_id, owner_email, owner_name, organization_name")
      .eq("tenant_id", params.tenantId)
      .maybeSingle(),
  ]);

  const tenantName =
    safeText((tenant as { name?: string | null } | null)?.name, "") ||
    safeText((provision as { organization_name?: string | null } | null)?.organization_name, "sua conta");
  const ownerName = safeText((provision as { owner_name?: string | null } | null)?.owner_name, "");
  const ownerMemberId = safeText((provision as { owner_member_id?: string | null } | null)?.owner_member_id, "");
  const ownerEmail = safeText((provision as { owner_email?: string | null } | null)?.owner_email, "");
  const systemNotificationPhone = safeText(
    (tenant as { system_notification_phone?: string | null } | null)?.system_notification_phone,
    "",
  );

  if (systemNotificationPhone) {
    return {
      phone: systemNotificationPhone,
      tenantName,
      ownerName: ownerName || null,
      source: "tenant_system_notification_phone",
    };
  }

  if (ownerMemberId) {
    const { data } = await params.sb
      .from("tenant_members")
      .select("phone")
      .eq("tenant_id", params.tenantId)
      .eq("id", ownerMemberId)
      .maybeSingle();
    const phone = safeText((data as { phone?: string | null } | null)?.phone, "");
    if (phone) {
      return { phone, tenantName, ownerName: ownerName || null, source: "owner_member_phone" };
    }
  }

  if (ownerEmail) {
    const { data } = await params.sb
      .from("tenant_members")
      .select("phone")
      .eq("tenant_id", params.tenantId)
      .eq("email", ownerEmail.toLowerCase())
      .maybeSingle();
    const phone = safeText((data as { phone?: string | null } | null)?.phone, "");
    if (phone) {
      return { phone, tenantName, ownerName: ownerName || null, source: "owner_email_member_phone" };
    }
  }

  const { data: firstDirector } = await params.sb
    .from("tenant_members")
    .select("nome, phone")
    .eq("tenant_id", params.tenantId)
    .eq("hierarchy_role", "director")
    .not("phone", "is", null)
    .limit(1)
    .maybeSingle();

  const directorPhone = safeText((firstDirector as { phone?: string | null } | null)?.phone, "");
  if (directorPhone) {
    return {
      phone: directorPhone,
      tenantName,
      ownerName: safeText((firstDirector as { nome?: string | null } | null)?.nome, "") || ownerName || null,
      source: "director_member_phone",
    };
  }

  return { phone: null, tenantName, ownerName: ownerName || null, source: "missing" };
}

function buildDedupeMetadata(params: {
  kind: NotificationKind;
  tenantId: string;
  integration: IntegrationDisconnectKind;
  sourceKey: string;
}) {
  return {
    kind: params.kind,
    tenant_id: params.tenantId,
    integration: params.integration,
    source_key: params.sourceKey,
  };
}

async function wasRecentlyNotified(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  kind: NotificationKind;
  tenantId: string;
  integration: IntegrationDisconnectKind;
  sourceKey: string;
}): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data, error } = await params.sb
    .from("system_notifications_log")
    .select("id")
    .eq("type", params.kind)
    .gte("created_at", since)
    .contains("metadata", buildDedupeMetadata(params))
    .limit(1);

  if (error) {
    console.warn("[integration-disconnect] dedupe query failed", {
      tenant_id: params.tenantId,
      integration: params.integration,
      error: error.message,
    });
    return false;
  }

  return Boolean(data?.length);
}

async function logSkippedNotification(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  kind: NotificationKind;
  tenantId: string;
  integration: IntegrationDisconnectKind;
  sourceKey: string;
  reason: string;
  message: string;
  metadata: Record<string, unknown>;
}) {
  await params.sb.from("system_notifications_log").insert({
    type: params.kind,
    to_number: "missing",
    message: params.message.slice(0, 4000),
    status: params.reason === "missing_tenant_owner_phone" ? "skipped" : "failed",
    error: params.reason,
    metadata: {
      ...buildDedupeMetadata(params),
      ...params.metadata,
    },
  });
}

export function buildIntegrationDisconnectedMessage(params: {
  integration: IntegrationDisconnectKind;
  tenantName: string;
  ownerName?: string | null;
  instanceName?: string | null;
  pageName?: string | null;
  state?: string | null;
  manual?: boolean;
}): string {
  const greeting = params.ownerName ? `Olá, ${params.ownerName}.` : "Olá.";
  if (params.integration === "whatsapp") {
    const reason = params.manual
      ? "A linha de WhatsApp foi desconectada manualmente"
      : `A linha de WhatsApp saiu do estado conectado${params.state ? ` (${params.state})` : ""}`;
    return [
      `${greeting} Aviso do MyChatCRM: ${reason} na conta ${params.tenantName}.`,
      "Enquanto estiver desconectada, os agentes não conseguem enviar mensagens automáticas por essa linha.",
      "Para normalizar, acesse Integrações > WhatsApp e reconecte a linha.",
    ].join(" ");
  }

  const page = params.pageName ? ` da página ${params.pageName}` : "";
  const reason = params.manual
    ? `A conexão Meta/Facebook${page} foi desconectada manualmente`
    : `A conexão Meta/Facebook${page} parece estar desconectada ou com token inválido`;
  return [
    `${greeting} Aviso do MyChatCRM: ${reason} na conta ${params.tenantName}.`,
    "Enquanto estiver desconectada, novos leads de formulários podem parar de entrar ou de acionar automações.",
    "Para normalizar, acesse Integrações > Meta Lead Ads e reconecte a página.",
  ].join(" ");
}

function resolveWhatsappPhoneForMessage(params: { waJid?: string | null; phoneDisplay?: string | null }): string | null {
  const display = (params.phoneDisplay ?? "").trim();
  if (display) return display;
  const digits = jidToDigits(params.waJid);
  return digits ? `+${digits}` : null;
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function buildIntegrationConnectedMessage(params: {
  integration: IntegrationDisconnectKind;
  tenantName: string;
  ownerName?: string | null;
  phone?: string | null;
  pageNames?: string[];
}): string {
  const greeting = params.ownerName ? `Olá, ${params.ownerName}.` : "Olá.";
  if (params.integration === "whatsapp") {
    const phoneText = params.phone ? ` (número ${params.phone})` : "";
    return [
      `${greeting} Aviso do MyChatCRM: uma nova linha de WhatsApp foi conectada com sucesso na conta ${params.tenantName}${phoneText}.`,
      "A partir de agora, os agentes já podem enviar e receber mensagens automáticas por essa linha.",
    ].join(" ");
  }

  const names = params.pageNames ?? [];
  const plural = names.length > 1;
  const nameList = formatNameList(names);
  const pageText = nameList ? ` (${plural ? "páginas" : "página"} ${nameList})` : "";
  return [
    `${greeting} Aviso do MyChatCRM: a integração com Meta Lead Ads foi conectada com sucesso na conta ${params.tenantName}${pageText}.`,
    `Novos leads recebidos por ${plural ? "essas páginas" : "essa página"} já podem entrar automaticamente no seu funil.`,
  ].join(" ");
}

export async function notifyTenantIntegrationDisconnected(params: {
  tenantId: string;
  integration: IntegrationDisconnectKind;
  source: string;
  sourceKey?: string | null;
  instanceName?: string | null;
  pageId?: string | null;
  pageName?: string | null;
  state?: string | null;
  previousState?: string | null;
  manual?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (params.tenantId === SYSTEM_TENANT_ID) {
    return { ok: true, skipped: "system_tenant" };
  }

  const sb = createSupabaseServiceClient();
  const sourceKey =
    params.sourceKey?.trim() ||
    params.instanceName?.trim() ||
    params.pageId?.trim() ||
    `${params.integration}:${params.source}`;

  if (
    await wasRecentlyNotified({
      sb,
      kind: INTEGRATION_DISCONNECTED_TYPE,
      tenantId: params.tenantId,
      integration: params.integration,
      sourceKey,
    })
  ) {
    console.info("[integration-disconnect] notification deduped", {
      tenant_id: params.tenantId,
      integration: params.integration,
      source_key: sourceKey,
      source: params.source,
    });
    return { ok: true, skipped: "deduped" };
  }

  const recipient = await loadTenantNotificationRecipient({ sb, tenantId: params.tenantId });
  const message = buildIntegrationDisconnectedMessage({
    integration: params.integration,
    tenantName: recipient.tenantName ?? "sua conta",
    ownerName: recipient.ownerName,
    instanceName: params.instanceName,
    pageName: params.pageName,
    state: params.state,
    manual: params.manual,
  });

  const metadata = {
    ...buildDedupeMetadata({ kind: INTEGRATION_DISCONNECTED_TYPE, tenantId: params.tenantId, integration: params.integration, sourceKey }),
    source: params.source,
    instance_name: params.instanceName ?? null,
    page_id: params.pageId ?? null,
    page_name: params.pageName ?? null,
    state: params.state ?? null,
    previous_state: params.previousState ?? null,
    manual: Boolean(params.manual),
    recipient_phone_last4: maskPhoneLast4(recipient.phone),
    recipient_source: recipient.source,
    ...(params.metadata ?? {}),
  };

  if (!recipient.phone) {
    await logSkippedNotification({
      sb,
      kind: INTEGRATION_DISCONNECTED_TYPE,
      tenantId: params.tenantId,
      integration: params.integration,
      sourceKey,
      reason: "missing_tenant_owner_phone",
      message,
      metadata,
    });
    console.warn("[integration-disconnect] missing tenant owner phone", {
      tenant_id: params.tenantId,
      integration: params.integration,
      source_key: sourceKey,
    });
    return { ok: false, skipped: "missing_tenant_owner_phone" };
  }

  const send = await sendSystemNotification(recipient.phone, message, "", {
    type: INTEGRATION_DISCONNECTED_TYPE,
    metadata,
  });

  if (!send.ok) {
    console.warn("[integration-disconnect] system notification failed", {
      tenant_id: params.tenantId,
      integration: params.integration,
      source_key: sourceKey,
      error: send.error,
    });
    return { ok: false, error: send.error };
  }

  console.info("[integration-disconnect] system notification sent", {
    tenant_id: params.tenantId,
    integration: params.integration,
    source_key: sourceKey,
    phone_last4: maskPhoneLast4(recipient.phone),
  });

  return { ok: true };
}

/**
 * Avisa o mesmo destinatário do alerta de desconexão quando uma integração é
 * conectada com sucesso — mostra o número (WhatsApp) ou o(s) nome(s) de
 * página (Facebook/Meta). Cada chamador decide, antes de chamar isto, se a
 * conexão é genuinamente nova (vs. uma reconfirmação/reauth) — esta função
 * só cuida do dedupe por janela (rede de segurança) e do envio em si.
 */
export async function notifyTenantIntegrationConnected(params: {
  tenantId: string;
  integration: IntegrationDisconnectKind;
  source: string;
  sourceKey: string;
  instanceName?: string | null;
  waJid?: string | null;
  phoneDisplay?: string | null;
  pageIds?: string[];
  pageNames?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (params.tenantId === SYSTEM_TENANT_ID) {
    return { ok: true, skipped: "system_tenant" };
  }

  const sb = createSupabaseServiceClient();
  const sourceKey = params.sourceKey;

  if (
    await wasRecentlyNotified({
      sb,
      kind: INTEGRATION_CONNECTED_TYPE,
      tenantId: params.tenantId,
      integration: params.integration,
      sourceKey,
    })
  ) {
    console.info("[integration-connect] notification deduped", {
      tenant_id: params.tenantId,
      integration: params.integration,
      source_key: sourceKey,
      source: params.source,
    });
    return { ok: true, skipped: "deduped" };
  }

  const recipient = await loadTenantNotificationRecipient({ sb, tenantId: params.tenantId });
  const phone = resolveWhatsappPhoneForMessage({ waJid: params.waJid, phoneDisplay: params.phoneDisplay });
  const message = buildIntegrationConnectedMessage({
    integration: params.integration,
    tenantName: recipient.tenantName ?? "sua conta",
    ownerName: recipient.ownerName,
    phone,
    pageNames: params.pageNames,
  });

  const metadata = {
    ...buildDedupeMetadata({ kind: INTEGRATION_CONNECTED_TYPE, tenantId: params.tenantId, integration: params.integration, sourceKey }),
    source: params.source,
    instance_name: params.instanceName ?? null,
    wa_jid: params.waJid ?? null,
    page_ids: params.pageIds ?? null,
    page_names: params.pageNames ?? null,
    recipient_phone_last4: maskPhoneLast4(recipient.phone),
    recipient_source: recipient.source,
    ...(params.metadata ?? {}),
  };

  if (!recipient.phone) {
    await logSkippedNotification({
      sb,
      kind: INTEGRATION_CONNECTED_TYPE,
      tenantId: params.tenantId,
      integration: params.integration,
      sourceKey,
      reason: "missing_tenant_owner_phone",
      message,
      metadata,
    });
    console.warn("[integration-connect] missing tenant owner phone", {
      tenant_id: params.tenantId,
      integration: params.integration,
      source_key: sourceKey,
    });
    return { ok: false, skipped: "missing_tenant_owner_phone" };
  }

  const send = await sendSystemNotification(recipient.phone, message, "", {
    type: INTEGRATION_CONNECTED_TYPE,
    metadata,
  });

  if (!send.ok) {
    console.warn("[integration-connect] system notification failed", {
      tenant_id: params.tenantId,
      integration: params.integration,
      source_key: sourceKey,
      error: send.error,
    });
    return { ok: false, error: send.error };
  }

  console.info("[integration-connect] system notification sent", {
    tenant_id: params.tenantId,
    integration: params.integration,
    source_key: sourceKey,
    phone_last4: maskPhoneLast4(recipient.phone),
  });

  return { ok: true };
}
