/**
 * Resolve e envia o 1º contacto WhatsApp de Meta Lead Ads.
 * Evolution (texto livre) ou Cloud API (template aprovado) conforme a regra.
 */
import "server-only";
import {
  listWhatsAppMessageTemplates,
  normalizeWhatsAppCloudToWaId,
  sendWhatsAppTemplateMessage,
  type WhatsAppCloudTemplate,
} from "@/lib/integrations/whatsapp-cloud";
import { resolveLiveEvolutionInstanceByIdForTenant } from "@/lib/server/evolution-instance-reconciliation";
import { sendEvolutionTextWithConnectionRecovery } from "@/lib/server/evolution-send-recovery";
import { lookupWhatsAppCloudConnectionByPhoneNumberId } from "@/lib/server/whatsapp-cloud-connections";

function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export type MetaLeadWhatsappTransport = "evolution" | "cloud_api";

export type ResolvedMetaLeadEvolutionConnection = {
  ok: true;
  transport: "evolution";
  connectionId: string;
  instance: {
    id: string;
    instance_name: string;
    connection_state: string | null;
  };
  adoptedSibling: boolean;
};

export type ResolvedMetaLeadCloudConnection = {
  ok: true;
  transport: "cloud_api";
  connectionId: string;
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  templateName: string;
  templateLang: string;
  bodyParamCount: number;
};

export type ResolvedMetaLeadConnection =
  | ResolvedMetaLeadEvolutionConnection
  | ResolvedMetaLeadCloudConnection
  | { ok: false; reason: string };

function inferTransport(
  explicit: string | null | undefined,
  connectionId: string,
): MetaLeadWhatsappTransport {
  if (explicit === "cloud_api" || explicit === "evolution") return explicit;
  // phone_number_id da Meta é numérico; UUID de tenant_evolution_instances não.
  return /^\d{8,}$/.test(connectionId) ? "cloud_api" : "evolution";
}

async function resolveApprovedMetaTemplate(params: {
  tenantId: string;
  phoneNumberId: string;
  templateName: string;
}): Promise<WhatsAppCloudTemplate | null> {
  const cloudConnection = await lookupWhatsAppCloudConnectionByPhoneNumberId(params.phoneNumberId);
  if (!cloudConnection || cloudConnection.tenant_id !== params.tenantId || !cloudConnection.waba_id) {
    return null;
  }
  const templates = await listWhatsAppMessageTemplates({
    wabaId: cloudConnection.waba_id,
    accessToken: cloudConnection.access_token,
  });
  return templates.find((t) => t.name === params.templateName) ?? null;
}

export async function resolveMetaLeadWhatsappConnection(params: {
  tenantId: string;
  connectionId: string;
  transport?: string | null;
  metaTemplateName?: string | null;
  metaTemplateLang?: string | null;
}): Promise<ResolvedMetaLeadConnection> {
  const connectionId = params.connectionId.trim();
  if (!connectionId) return { ok: false, reason: "connection_not_selected" };

  const transport = inferTransport(params.transport, connectionId);

  if (transport === "evolution") {
    const live = await resolveLiveEvolutionInstanceByIdForTenant(params.tenantId, connectionId);
    if (!live.ok) {
      return { ok: false, reason: live.reason };
    }
    return {
      ok: true,
      transport: "evolution",
      connectionId,
      instance: {
        id: live.instance.id,
        instance_name: live.instance.instance_name,
        connection_state: live.instance.connection_state ?? null,
      },
      adoptedSibling: Boolean(live.adoptedSibling),
    };
  }

  const cloud = await lookupWhatsAppCloudConnectionByPhoneNumberId(connectionId);
  if (!cloud || cloud.tenant_id !== params.tenantId || !cloud.active) {
    return { ok: false, reason: "connection_not_found" };
  }
  const accessToken = cloud.access_token?.trim() ?? "";
  if (!accessToken) return { ok: false, reason: "meta_access_token_missing" };
  if (!cloud.waba_id?.trim()) return { ok: false, reason: "meta_waba_missing" };

  const templateName = params.metaTemplateName?.trim() ?? "";
  if (!templateName) return { ok: false, reason: "meta_template_missing" };

  const template = await resolveApprovedMetaTemplate({
    tenantId: params.tenantId,
    phoneNumberId: cloud.phone_number_id,
    templateName,
  });
  if (!template || template.status !== "APPROVED") {
    return { ok: false, reason: "meta_template_not_approved" };
  }

  return {
    ok: true,
    transport: "cloud_api",
    connectionId: cloud.phone_number_id,
    phoneNumberId: cloud.phone_number_id,
    accessToken,
    wabaId: cloud.waba_id,
    templateName,
    templateLang: params.metaTemplateLang?.trim() || template.language || "pt_BR",
    bodyParamCount: template.bodyParamCount,
  };
}

export type MetaLeadSendResult =
  | {
      ok: true;
      channel: "evolution" | "meta_cloud";
      persistenceConnectionId: string;
      providerMessageId: string | null;
      evolutionPayload?: unknown;
      restarted?: boolean;
      attempts?: number;
    }
  | { ok: false; error: string; status?: number };

/** Params do template: nome / resposta IA / telefone (até bodyParamCount). */
export function buildMetaLeadCloudTemplateParams(params: {
  leadName: string;
  phone: string;
  replyText: string;
  bodyParamCount: number;
}): string[] {
  if (params.bodyParamCount <= 0) return [];
  const name = params.leadName.trim() || "cliente";
  const phone = digitsOnly(params.phone);
  const ai = params.replyText.replace(/\s+/g, " ").trim().slice(0, 1024);
  if (params.bodyParamCount === 1) {
    return [ai || name];
  }
  const base = [name, ai || "", phone];
  return base.slice(0, params.bodyParamCount);
}

export async function sendMetaLeadInitialWhatsapp(params: {
  connection: ResolvedMetaLeadEvolutionConnection | ResolvedMetaLeadCloudConnection;
  evoNumber: string;
  phone: string;
  leadName: string;
  replyText: string;
}): Promise<MetaLeadSendResult> {
  const { connection } = params;

  if (connection.transport === "evolution") {
    const send = await sendEvolutionTextWithConnectionRecovery({
      instanceName: connection.instance.instance_name,
      number: params.evoNumber,
      text: params.replyText,
      resolveRecipient: true,
    });
    if (!send.ok) {
      return { ok: false, error: send.error ?? "evolution_send_failed", status: send.status };
    }
    return {
      ok: true,
      channel: "evolution",
      persistenceConnectionId: connection.instance.id,
      providerMessageId: null,
      evolutionPayload: send.data,
      restarted: send.restarted,
      attempts: send.attempts,
    };
  }

  const toWaId = normalizeWhatsAppCloudToWaId(params.phone) || normalizeWhatsAppCloudToWaId(params.evoNumber);
  if (!toWaId) return { ok: false, error: "invalid_phone", status: 400 };

  const bodyParams = buildMetaLeadCloudTemplateParams({
    leadName: params.leadName,
    phone: toWaId,
    replyText: params.replyText,
    bodyParamCount: connection.bodyParamCount,
  });

  const sent = await sendWhatsAppTemplateMessage({
    toWaId,
    templateName: connection.templateName,
    languageCode: connection.templateLang,
    bodyParams: bodyParams.length > 0 ? bodyParams : undefined,
    phoneNumberId: connection.phoneNumberId,
    accessToken: connection.accessToken,
  });
  if (!sent.ok) {
    return { ok: false, error: sent.error ?? "meta_send_failed", status: sent.status };
  }
  return {
    ok: true,
    channel: "meta_cloud",
    persistenceConnectionId: connection.phoneNumberId,
    providerMessageId: sent.messageId ?? null,
  };
}
