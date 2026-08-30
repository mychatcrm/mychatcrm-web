import "server-only";

import type { ClientSession } from "@/lib/client-auth";
import type { ExternalApiAuthType } from "@/lib/external-api/types";
import type {
  ExternalApiConnectorCard,
  IntegrationsCloudSnapshot,
  IntegrationsDashboardSnapshotV1,
  IntegrationsEvolutionSnapshot,
} from "@/lib/integrations/dashboard-snapshot";
import { resolveOrganizationRole } from "@/lib/organization-role";
import type { TenantWhatsappConnection } from "@/lib/server/tenant-whatsapp-connections";
import type { SlotProvider, SlotPurpose } from "@/lib/server/whatsapp-slot-provider";
import { serverWhatsAppSlotCapacity } from "@/lib/server/whatsapp-slot-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const asRows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const asString = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const asNullableString = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const asNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const asStringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  : [];

function formatJidPhone(jid: string | null): string | null {
  if (!jid) return null;
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function buildMetaStatus(rawMeta: Row) {
  const grant = asRow(rawMeta.grant);
  const rules = asRows(rawMeta.rules).sort((a, b) => asNumber(a.order_index ?? 999) - asNumber(b.order_index ?? 999));
  const mappings = asRows(rawMeta.form_mappings);

  const pages = asRows(rawMeta.pages).map((page) => {
    const pageId = asString(page.page_id);
    const allFormsHaveActiveRule = rules.some((rule) =>
      asString(rule.page_id).trim() === pageId && rule.use_all_forms === true,
    );
    const formIds = new Set<string>();
    for (const rule of rules) {
      if (asString(rule.page_id).trim() !== pageId) continue;
      for (const formId of asStringArray(rule.included_form_ids)) formIds.add(formId);
    }
    for (const mapping of mappings) {
      if (asString(mapping.page_id).trim() === pageId) formIds.add(asString(mapping.form_id));
    }

    const forms = [...formIds].filter(Boolean).map((formId) => {
      const mapping = mappings.find((candidate) => asString(candidate.form_id) === formId && asString(candidate.page_id) === pageId);
      for (const rule of rules) {
        if (asString(rule.page_id).trim() !== pageId) continue;
        if (asStringArray(rule.excluded_form_ids).includes(formId)) continue;
        if (rule.use_all_forms === true || asStringArray(rule.included_form_ids).includes(formId)) {
          return {
            form_id: formId,
            form_name: asNullableString(mapping?.form_name),
            agent_id: asStringArray(rule.agent_ids)[0] ?? asNullableString(mapping?.agent_id),
            has_active_rule: true,
          };
        }
      }
      return {
        form_id: formId,
        form_name: asNullableString(mapping?.form_name),
        agent_id: asNullableString(mapping?.agent_id),
        has_active_rule: false,
      };
    });

    return {
      page_id: pageId,
      page_name: asNullableString(page.page_name),
      connected_at: asString(page.connected_at),
      health_status: asString(page.health_status, "unverified") as IntegrationsDashboardSnapshotV1["meta"]["pages"][number]["health_status"],
      health_code: asNullableString(page.health_code),
      health_message: asNullableString(page.health_message),
      lead_access_status: asString(page.lead_access_status, "unverified") as IntegrationsDashboardSnapshotV1["meta"]["pages"][number]["lead_access_status"],
      last_lead_access_verified_at: asNullableString(page.last_lead_access_verified_at),
      last_verified_at: asNullableString(page.last_verified_at),
      last_webhook_at: asNullableString(page.last_webhook_at),
      subscribed_fields: asStringArray(page.subscribed_fields),
      forms_error: null,
      all_forms_have_active_rule: allFormsHaveActiveRule,
      forms,
    };
  });

  const discoveryStatus = asNullableString(grant.discovery_status) as IntegrationsDashboardSnapshotV1["meta"]["grant_discovery_status"];
  const grantPending = discoveryStatus === "pending" || discoveryStatus === "discovering" || discoveryStatus === "retrying";
  const grantActionRequired = discoveryStatus === "action_required";
  const operational = (status: string) => status === "ready" || status === "degraded" || status === "legacy_grace";
  const connected = !grantPending && !grantActionRequired && pages.some((page) => operational(page.health_status));
  const actionRequired = grantActionRequired || pages.some((page) =>
    page.health_status === "action_required" || page.health_status === "revoked" || page.lead_access_status === "action_required",
  );
  const verificationPending = grantPending || pages.some((page) =>
    page.health_status === "provisioning" ||
    page.health_status === "retrying" ||
    page.health_status === "unverified" ||
    page.health_status === "degraded" ||
    page.health_status === "legacy_grace" ||
    page.lead_access_status === "unverified" ||
    page.lead_access_status === "pending_first_lead",
  );

  return {
    connected,
    action_required: actionRequired,
    verification_pending: verificationPending,
    grant_discovery_status: discoveryStatus,
    grant_error_code: asNullableString(grant.last_error_code),
    pages,
  } satisfies IntegrationsDashboardSnapshotV1["meta"];
}

export async function loadIntegrationsDashboardSnapshot(
  session: ClientSession,
): Promise<IntegrationsDashboardSnapshotV1> {
  const startedAt = performance.now();
  const { data, error } = await createSupabaseServiceClient().rpc(
    "get_integrations_dashboard_snapshot_v1",
    { p_tenant_id: session.tenantId },
  );
  if (error) throw new Error(`[integrations-bootstrap] snapshot_rpc:${error.message}`);

  const raw = asRow(data);
  const rawWhatsapp = asRow(raw.whatsapp);
  const slotRows = asRows(rawWhatsapp.slot_states);
  const evolutionRows = asRows(rawWhatsapp.evolution);
  const cloudRows = asRows(rawWhatsapp.cloud);
  const activeProviderBySlot = new Map<number, SlotProvider>();
  const purposeBySlot: Record<number, SlotPurpose | null> = {};
  for (const row of slotRows) {
    const slotIndex = asNumber(row.slot_index);
    activeProviderBySlot.set(slotIndex, row.active_provider === "cloud_api" ? "cloud_api" : "evolution");
    purposeBySlot[slotIndex] = row.purpose === "forms" || row.purpose === "direct" ? row.purpose : null;
  }

  const evolutionBySlot: Record<number, IntegrationsEvolutionSnapshot> = {};
  const cloudBySlot: Record<number, IntegrationsCloudSnapshot> = {};
  const connections: TenantWhatsappConnection[] = [];
  for (const row of evolutionRows) {
    const slotIndex = asNumber(row.slot_index);
    const waJid = asNullableString(row.wa_jid);
    const state = asString(row.connection_state, "close");
    const snapshot: IntegrationsEvolutionSnapshot = {
      id: asString(row.id),
      slotIndex,
      instanceName: asString(row.instance_name),
      connectionState: state,
      waJid,
      updatedAt: asString(row.updated_at),
    };
    evolutionBySlot[slotIndex] = snapshot;
    const phone = formatJidPhone(waJid);
    connections.push({
      connectionId: snapshot.id,
      transport: "evolution",
      label: phone ? `QR Code · ${phone}` : "QR Code",
      slotIndex,
      connected: state === "open",
      activeProvider: activeProviderBySlot.get(slotIndex) ?? "evolution",
    });
  }
  for (const row of cloudRows) {
    const slotIndex = asNumber(row.slot_index);
    const displayPhone = asNullableString(row.display_phone);
    const phoneNumberId = asString(row.phone_number_id);
    cloudBySlot[slotIndex] = {
      connected: true,
      phone_number_id: phoneNumberId,
      display_phone: displayPhone,
      verified_name: asNullableString(row.verified_name),
      updatedAt: asString(row.updated_at),
    };
    connections.push({
      connectionId: phoneNumberId,
      transport: "cloud_api",
      label: displayPhone ? `API Meta · ${displayPhone}` : "API Meta",
      slotIndex,
      connected: true,
      activeProvider: activeProviderBySlot.get(slotIndex) ?? "evolution",
    });
  }
  connections.sort((a, b) => a.slotIndex - b.slotIndex || a.transport.localeCompare(b.transport));

  const extraSlots = Math.max(0, asNumber(rawWhatsapp.extra_slots));
  const totalSlots = serverWhatsAppSlotCapacity(session, extraSlots);
  const offerRow = asRow(rawWhatsapp.offer);
  const offer = Object.keys(offerRow).length ? {
    amount_cents: Number.isFinite(Number(offerRow.amount_cents)) ? Number(offerRow.amount_cents) : null,
    currency: asString(offerRow.currency, "brl"),
    interval_unit: offerRow.interval_unit === "year" ? "year" as const : offerRow.interval_unit === "month" ? "month" as const : null,
  } : null;

  const rawExternal = asRow(raw.external_apis);
  const purchased = Math.max(0, asNumber(rawExternal.purchased));
  const totalExternal = 1 + purchased;
  const externalConnectors: ExternalApiConnectorCard[] = asRows(rawExternal.connectors).map((row, index) => {
    const effective = index < totalExternal;
    const authType = ["bearer", "api_key", "basic", "oauth2_client_credentials"].includes(asString(row.auth_type))
      ? asString(row.auth_type) as ExternalApiAuthType
      : "none";
    const healthStatus = ["healthy", "degraded", "error"].includes(asString(row.health_status))
      ? asString(row.health_status) as ExternalApiConnectorCard["healthStatus"]
      : "untested";
    const syncFrequency = asNumber(row.sync_frequency_minutes);
    return {
      id: asString(row.id),
      name: asString(row.name),
      description: asString(row.description),
      baseUrl: asString(row.base_url),
      authType,
      authHeaderName: asNullableString(row.auth_header_name),
      authUsername: asNullableString(row.auth_username),
      oauthTokenUrl: asNullableString(row.oauth_token_url),
      oauthClientId: asNullableString(row.oauth_client_id),
      environment: row.environment === "sandbox" ? "sandbox" : "production",
      credentialConfigured: row.credential_configured === true,
      enabled: row.enabled === true,
      isPrimary: row.is_primary === true,
      effective,
      billingStatus: index === 0 ? "included" : effective ? "extra_active" : "suspended",
      healthStatus,
      lastHealthAt: asNullableString(row.last_health_at),
      lastErrorCode: asNullableString(row.last_error_code),
      agentCount: Math.max(0, asNumber(row.agent_count)),
      operationCount: Math.max(0, asNumber(row.operation_count)),
      syncEnabled: row.sync_enabled === true,
      syncOperationKey: asNullableString(row.sync_operation_key),
      syncFrequencyMinutes: [30, 60, 180, 360, 720, 1440].includes(syncFrequency)
        ? syncFrequency as ExternalApiConnectorCard["syncFrequencyMinutes"] : null,
      lastSyncAt: asNullableString(row.last_sync_at),
      lastSyncStatus: row.last_sync_status === "success" || row.last_sync_status === "error" ? row.last_sync_status : null,
      lastSyncError: asNullableString(row.last_sync_error),
      lastSyncItemCount: Number.isFinite(asNumber(row.last_sync_item_count)) && row.last_sync_item_count != null
        ? asNumber(row.last_sync_item_count) : null,
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  });

  const role = resolveOrganizationRole(session);
  const snapshot: IntegrationsDashboardSnapshotV1 = {
    version: 1,
    generatedAt: asString(raw.generated_at, new Date().toISOString()),
    permissions: { role, canManageExternalApis: role === "owner" },
    whatsapp: {
      capacity: { totalSlots, extraSlots, includedLines: totalSlots - extraSlots },
      offer,
      connections,
      purposeBySlot,
      evolutionBySlot,
      cloudBySlot,
    },
    meta: buildMetaStatus(asRow(raw.meta)),
    externalApis: {
      connectors: externalConnectors,
      capacity: { included: 1, purchased, total: totalExternal, used: Math.max(0, asNumber(rawExternal.used)) },
    },
  };
  console.info("[integrations-bootstrap] snapshot_ready", {
    tenant_id: session.tenantId,
    duration_ms: Math.round(performance.now() - startedAt),
    connections: connections.length,
    meta_pages: snapshot.meta.pages.length,
    external_connectors: externalConnectors.length,
  });
  return snapshot;
}
