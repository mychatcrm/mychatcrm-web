import "server-only";

import { sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const SYSTEM_NOTIFICATION_TYPE = "integration_disconnected";
const DEDUPE_WINDOW_MS = 4 * 60 * 60 * 1000;

export type IntegrationDisconnectKind = "whatsapp" | "facebook";

export function normalizeConnectionState(state: string | null | undefined): string {
  return (state ?? "").trim().toLowerCase();
}

export function isDisconnectedConnectionState(state: string | null | undefined): boolean {
  const normalized = normalizeConnectionState(state);
  return Boolean(normalized) && normalized !== "open";
}

export function shouldNotifyWhatsappDisconnect(params: {
  previousState?: string | null;
  nextState?: string | null;
}): boolean {
  return normalizeConnectionState(params.previousState) === "open" && isDisconnectedConnectionState(params.nextState);
}

function maskPhoneLast4(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function safeText(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").trim();
  return text || fallback;
}

async function loadTenantNotificationRecipient(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
}): Promise<{ phone: string | null; tenantName: string | null; ownerName: string | null }> {
  const [{ data: tenant }, { data: provision }] = await Promise.all([
    params.sb
      .from("tenants")
      .select("name")
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

  if (ownerMemberId) {
    const { data } = await params.sb
      .from("tenant_members")
      .select("phone")
      .eq("tenant_id", params.tenantId)
      .eq("id", ownerMemberId)
      .maybeSingle();
    const phone = safeText((data as { phone?: string | null } | null)?.phone, "");
    if (phone) return { phone, tenantName, ownerName: ownerName || null };
  }

  if (ownerEmail) {
    const { data } = await params.sb
      .from("tenant_members")
      .select("phone")
      .eq("tenant_id", params.tenantId)
      .eq("email", ownerEmail.toLowerCase())
      .maybeSingle();
    const phone = safeText((data as { phone?: string | null } | null)?.phone, "");
    if (phone) return { phone, tenantName, ownerName: ownerName || null };
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
    };
  }

  return { phone: null, tenantName, ownerName: ownerName || null };
}

function buildDedupeMetadata(params: {
  tenantId: string;
  integration: IntegrationDisconnectKind;
  sourceKey: string;
}) {
  return {
    kind: "integration_disconnected",
    tenant_id: params.tenantId,
    integration: params.integration,
    source_key: params.sourceKey,
  };
}

async function wasRecentlyNotified(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  integration: IntegrationDisconnectKind;
  sourceKey: string;
}): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data, error } = await params.sb
    .from("system_notifications_log")
    .select("id")
    .eq("type", SYSTEM_NOTIFICATION_TYPE)
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
  tenantId: string;
  integration: IntegrationDisconnectKind;
  sourceKey: string;
  reason: string;
  message: string;
  metadata: Record<string, unknown>;
}) {
  await params.sb.from("system_notifications_log").insert({
    type: SYSTEM_NOTIFICATION_TYPE,
    to_number: "missing",
    message: params.message.slice(0, 4000),
    status: "failed",
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
  const sb = createSupabaseServiceClient();
  const sourceKey =
    params.sourceKey?.trim() ||
    params.instanceName?.trim() ||
    params.pageId?.trim() ||
    `${params.integration}:${params.source}`;

  if (await wasRecentlyNotified({ sb, tenantId: params.tenantId, integration: params.integration, sourceKey })) {
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
    ...buildDedupeMetadata({ tenantId: params.tenantId, integration: params.integration, sourceKey }),
    source: params.source,
    instance_name: params.instanceName ?? null,
    page_id: params.pageId ?? null,
    page_name: params.pageName ?? null,
    state: params.state ?? null,
    previous_state: params.previousState ?? null,
    manual: Boolean(params.manual),
    recipient_phone_last4: maskPhoneLast4(recipient.phone),
    ...(params.metadata ?? {}),
  };

  if (!recipient.phone) {
    await logSkippedNotification({
      sb,
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
    type: SYSTEM_NOTIFICATION_TYPE,
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
