import "server-only";

import type { ExternalApiConnectorInput, ExternalApiConnectorSummary, ExternalApiCapacity, ExternalApiOperationInput, ExternalApiPagination, ExternalApiSyncFrequencyMinutes } from "@/lib/external-api/types";
import { EXTERNAL_API_SYNC_FREQUENCIES_MINUTES } from "@/lib/external-api/types";
import { encryptExternalApiCredential, maskExternalApiCredential } from "@/lib/server/external-api-crypto";
import { externalApiCredentialFromInput, validateExternalApiConnectorInput } from "@/lib/server/external-api-validation";
import { listTenantBillingEntitlements, sumTenantEntitlementQuantity } from "@/lib/server/billing-addons";
import { logExternalApiConnectorAudit } from "@/lib/server/external-api-connector-audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const stringValue = (value: unknown) => typeof value === "string" ? value : "";

function paginationFromRow(value: unknown): ExternalApiPagination {
  const row = value && typeof value === "object" ? (value as Row) : {};
  const mode = ["none", "page_param", "cursor_param"].includes(stringValue(row.mode))
    ? (row.mode as ExternalApiPagination["mode"]) : "none";
  return {
    mode,
    maxPages: Number.isFinite(Number(row.maxPages)) ? Number(row.maxPages) : 10,
    ...(stringValue(row.pageParam) ? { pageParam: stringValue(row.pageParam) } : {}),
    ...(stringValue(row.pageSizeParam) ? { pageSizeParam: stringValue(row.pageSizeParam) } : {}),
    ...(Number.isFinite(Number(row.pageSize)) && Number(row.pageSize) > 0 ? { pageSize: Number(row.pageSize) } : {}),
    ...(stringValue(row.cursorPath) ? { cursorPath: stringValue(row.cursorPath) } : {}),
  };
}

function operationFromRow(row: Row): ExternalApiOperationInput {
  return {
    id: stringValue(row.id), operationKey: stringValue(row.operation_key), name: stringValue(row.name),
    description: stringValue(row.description), method: row.method === "POST" ? "POST" : "GET",
    pathTemplate: stringValue(row.path_template),
    parameters: Array.isArray(row.parameters) ? row.parameters as ExternalApiOperationInput["parameters"] : [],
    responseMapping: row.response_mapping && typeof row.response_mapping === "object"
      ? row.response_mapping as ExternalApiOperationInput["responseMapping"] : {},
    cacheTtlSeconds: [0, 30, 60, 120, 300].includes(Number(row.cache_ttl_seconds))
      ? Number(row.cache_ttl_seconds) as ExternalApiOperationInput["cacheTtlSeconds"] : 0,
    enabled: row.enabled !== false,
    pagination: paginationFromRow(row.pagination),
  };
}

export async function getExternalApiCapacity(tenantId: string): Promise<ExternalApiCapacity> {
  const entitlements = await listTenantBillingEntitlements({ tenantId, kind: "api_connector" });
  const purchased = sumTenantEntitlementQuantity(entitlements, "api_connector", "recurring");
  const { count, error } = await createSupabaseServiceClient().from("external_api_connectors")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (error) throw new Error(`[external-api] capacity:${error.message}`);
  return { included: 1, purchased, total: 1 + purchased, used: count ?? 0 };
}

export async function listExternalApiConnectors(tenantId: string): Promise<{ connectors: ExternalApiConnectorSummary[]; capacity: ExternalApiCapacity }> {
  const sb = createSupabaseServiceClient();
  const [{ data, error }, capacity] = await Promise.all([
    sb.from("external_api_connectors").select("*, external_api_operations!external_api_operations_connector_id_tenant_id_fkey(*), agent_external_api_connectors(agent_id)")
      .eq("tenant_id", tenantId).order("is_primary", { ascending: false }).order("created_at", { ascending: true }),
    getExternalApiCapacity(tenantId),
  ]);
  if (error) throw new Error(`[external-api] list:${error.message}`);
  return { capacity, connectors: ((data ?? []) as Row[]).map((row, index) => {
    const effective = index < capacity.total;
    const authConfig = row.auth_config && typeof row.auth_config === "object" ? (row.auth_config as Row) : {};
    const syncFrequency = Number(row.sync_frequency_minutes);
    return {
      id: stringValue(row.id), name: stringValue(row.name), description: stringValue(row.description), baseUrl: stringValue(row.base_url),
      authType: ["bearer", "api_key", "basic", "oauth2_client_credentials"].includes(stringValue(row.auth_type))
        ? stringValue(row.auth_type) as ExternalApiConnectorSummary["authType"] : "none",
      authHeaderName: stringValue(row.auth_header_name) || null, authUsername: stringValue(row.auth_username) || null,
      oauthTokenUrl: stringValue(authConfig.tokenUrl) || null, oauthClientId: stringValue(authConfig.clientId) || null,
      environment: row.environment === "sandbox" ? "sandbox" : "production",
      credentialConfigured: Boolean(row.credential_ciphertext), credentialMask: maskExternalApiCredential(stringValue(row.credential_fingerprint) || null),
      enabled: row.enabled === true, isPrimary: row.is_primary === true, effective,
      billingStatus: index === 0 ? "included" : effective ? "extra_active" : "suspended",
      healthStatus: ["healthy", "degraded", "error"].includes(stringValue(row.health_status))
        ? stringValue(row.health_status) as ExternalApiConnectorSummary["healthStatus"] : "untested",
      lastHealthAt: stringValue(row.last_health_at) || null, lastErrorCode: stringValue(row.last_error_code) || null,
      agentCount: Array.isArray(row.agent_external_api_connectors) ? row.agent_external_api_connectors.length : 0,
      operations: Array.isArray(row.external_api_operations)
        ? (row.external_api_operations as Row[]).sort((a, b) => Number(a.position) - Number(b.position)).map(operationFromRow) : [],
      syncEnabled: row.sync_enabled === true,
      syncOperationKey: stringValue(row.sync_operation_key) || null,
      syncFrequencyMinutes: (EXTERNAL_API_SYNC_FREQUENCIES_MINUTES as readonly number[]).includes(syncFrequency)
        ? syncFrequency as ExternalApiSyncFrequencyMinutes : null,
      lastSyncAt: stringValue(row.last_sync_at) || null,
      lastSyncStatus: row.last_sync_status === "success" || row.last_sync_status === "error" ? row.last_sync_status : null,
      lastSyncError: stringValue(row.last_sync_error) || null,
      lastSyncItemCount: Number.isFinite(Number(row.last_sync_item_count)) ? Number(row.last_sync_item_count) : null,
      createdAt: stringValue(row.created_at), updatedAt: stringValue(row.updated_at),
    };
  }) };
}

export async function saveExternalApiConnector(params: { tenantId: string; connectorId?: string; actorId?: string | null; input: ExternalApiConnectorInput }): Promise<string> {
  const input = validateExternalApiConnectorInput(params.input);
  const sb = createSupabaseServiceClient();
  if (!params.connectorId) {
    const capacity = await getExternalApiCapacity(params.tenantId);
    if (capacity.used >= capacity.total) throw new Error("external_api_capacity_required");
  }
  let previous: Row | null = null;
  if (params.connectorId) {
    const result = await sb.from("external_api_connectors").select("*").eq("tenant_id", params.tenantId).eq("id", params.connectorId).maybeSingle();
    if (result.error) throw new Error(`[external-api] lookup:${result.error.message}`);
    previous = result.data as Row | null;
    if (!previous) throw new Error("external_api_connector_not_found");
  }
  const credential = input.authType === "none" ? null : input.secret
    ? encryptExternalApiCredential(externalApiCredentialFromInput(input)!) : null;
  if (input.authType !== "none" && !credential && !previous?.credential_ciphertext) throw new Error("external_api_secret_required");
  const connectorId = params.connectorId ?? crypto.randomUUID();
  const authConfig = input.authType === "oauth2_client_credentials"
    ? { tokenUrl: input.oauthTokenUrl, clientId: input.oauthClientId }
    : {};
  const { error } = await sb.from("external_api_connectors").upsert({
    id: connectorId, tenant_id: params.tenantId, name: input.name, description: input.description,
    base_url: input.baseUrl, base_origin: input.baseOrigin, auth_type: input.authType,
    auth_header_name: input.authHeaderName ?? null, auth_username: input.authUsername ?? null,
    auth_config: authConfig, environment: input.environment,
    credential_ciphertext: input.authType === "none" ? null : credential?.ciphertext ?? previous?.credential_ciphertext,
    credential_fingerprint: input.authType === "none" ? null : credential?.fingerprint ?? previous?.credential_fingerprint,
    credential_key_version: input.authType === "none" ? 1 : credential?.keyVersion ?? previous?.credential_key_version ?? 1,
    enabled: input.enabled,
    sync_enabled: input.syncEnabled, sync_operation_key: input.syncOperationKey, sync_frequency_minutes: input.syncFrequencyMinutes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`[external-api] save:${error.message}`);
  const { error: deleteError } = await sb.from("external_api_operations").delete().eq("tenant_id", params.tenantId).eq("connector_id", connectorId);
  if (deleteError) throw new Error(`[external-api] operations_delete:${deleteError.message}`);
  const { error: operationsError } = await sb.from("external_api_operations").insert(input.operations.map((operation, position) => ({
    id: operation.id || crypto.randomUUID(), tenant_id: params.tenantId, connector_id: connectorId,
    operation_key: operation.operationKey, name: operation.name, description: operation.description,
    method: operation.method, path_template: operation.pathTemplate, parameters: operation.parameters,
    response_mapping: operation.responseMapping, cache_ttl_seconds: operation.cacheTtlSeconds, enabled: operation.enabled,
    pagination: operation.pagination ?? { mode: "none", maxPages: 10 }, position,
  })));
  if (operationsError) throw new Error(`[external-api] operations_save:${operationsError.message}`);
  if (!params.connectorId) {
    const { count } = await sb.from("external_api_connectors").select("id", { count: "exact", head: true })
      .eq("tenant_id", params.tenantId).eq("is_primary", true);
    if (!count) await sb.rpc("set_external_api_primary", { p_tenant_id: params.tenantId, p_connector_id: connectorId });
  }
  void logExternalApiConnectorAudit({
    tenantId: params.tenantId, connectorId, actorId: params.actorId,
    action: params.connectorId ? "connector_updated" : "connector_created",
    detail: { name: input.name, authType: input.authType, syncEnabled: input.syncEnabled, credentialRotated: Boolean(credential) },
  });
  return connectorId;
}

export async function deleteExternalApiConnector(tenantId: string, connectorId: string, actorId?: string | null): Promise<void> {
  const { error } = await createSupabaseServiceClient().from("external_api_connectors").delete().eq("tenant_id", tenantId).eq("id", connectorId);
  if (error) throw new Error(`[external-api] delete:${error.message}`);
  void logExternalApiConnectorAudit({ tenantId, connectorId, actorId, action: "connector_deleted" });
}

export async function setExternalApiPrimary(tenantId: string, connectorId: string): Promise<void> {
  const { error } = await createSupabaseServiceClient().rpc("set_external_api_primary", { p_tenant_id: tenantId, p_connector_id: connectorId });
  if (error) throw new Error(`[external-api] primary:${error.message}`);
}

export async function listAgentExternalApiConnectorIds(tenantId: string, agentId: string): Promise<string[]> {
  const { data, error } = await createSupabaseServiceClient().from("agent_external_api_connectors").select("connector_id")
    .eq("tenant_id", tenantId).eq("agent_id", agentId);
  if (error) throw new Error(`[external-api] agent_links:${error.message}`);
  return ((data ?? []) as Row[]).map((row) => stringValue(row.connector_id)).filter(Boolean);
}

export async function validateAgentExternalApiConnectorIds(tenantId: string, connectorIds: string[]): Promise<string[]> {
  const unique = [...new Set(connectorIds.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return [];
  const available = await listExternalApiConnectors(tenantId);
  const allowed = new Set(available.connectors.filter((item) => item.enabled && item.effective).map((item) => item.id));
  if (unique.some((id) => !allowed.has(id))) throw new Error("external_api_connector_not_available");
  return unique;
}

export async function syncAgentExternalApiConnectors(tenantId: string, agentId: string, connectorIds: string[]): Promise<void> {
  const unique = await validateAgentExternalApiConnectorIds(tenantId, connectorIds);
  const sb = createSupabaseServiceClient();
  const { error: deleteError } = await sb.from("agent_external_api_connectors").delete().eq("tenant_id", tenantId).eq("agent_id", agentId);
  if (deleteError) throw new Error(`[external-api] agent_links_delete:${deleteError.message}`);
  if (!unique.length) return;
  const { error } = await sb.from("agent_external_api_connectors").insert(unique.map((connectorId) => ({ tenant_id: tenantId, agent_id: agentId, connector_id: connectorId })));
  if (error) throw new Error(`[external-api] agent_links_save:${error.message}`);
}
