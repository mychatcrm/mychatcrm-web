import "server-only";

import type { ExternalApiOperationInput } from "@/lib/external-api/types";
import { decryptExternalApiCredential } from "@/lib/server/external-api-crypto";
import { buildExternalApiRequest, executeExternalApiHttpRequest } from "@/lib/server/external-api-http";
import { normalizeExternalApiResponse } from "@/lib/server/external-api-normalize";
import { getValidOAuthAccessToken } from "@/lib/server/external-api-oauth";
import { logExternalApiConnectorAudit } from "@/lib/server/external-api-connector-audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type Row = Record<string, unknown>;

/** Margem antes do maxDuration da function — mesmo padrão de PROCESS_TIME_BUDGET_MS em whatsapp-campaigns.ts. */
const SYNC_TIME_BUDGET_MS = 80_000;
const DEFAULT_PAGE_SIZE = 50;

function readJsonPath(payload: unknown, path?: string): unknown {
  if (!path) return undefined;
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Row)[segment];
  }
  return current;
}

async function finalizeFailure(
  sb: ServiceClient,
  tenantId: string,
  connectorId: string,
  message: string,
): Promise<{ ok: false; itemCount: number; error: string }> {
  await sb.from("external_api_connectors").update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: "error",
    last_sync_error: message.slice(0, 500),
  }).eq("tenant_id", tenantId).eq("id", connectorId);
  void logExternalApiConnectorAudit({ tenantId, connectorId, action: "sync_failed", detail: { error: message } });
  return { ok: false, itemCount: 0, error: message };
}

/**
 * Percorre a operação de sincronização do conector, normaliza cada página
 * (mesmo `normalizeExternalApiResponse` do caminho ao vivo) e faz upsert em
 * `external_api_catalog_items` por `(tenant_id, connector_id, external_id)`.
 * Ao final, qualquer item que não apareceu nesta passada vira `is_active:false`
 * — nunca `DELETE` (histórico nunca é apagado).
 */
export async function syncExternalApiConnectorCatalog(params: {
  sb?: ServiceClient;
  tenantId: string;
  connectorId: string;
}): Promise<{ ok: boolean; itemCount: number; error?: string }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const startedAt = Date.now();
  const syncStartedIso = new Date(startedAt).toISOString();

  const { data: connectorRow, error: connectorError } = await sb.from("external_api_connectors")
    .select("*").eq("tenant_id", params.tenantId).eq("id", params.connectorId).maybeSingle();
  if (connectorError || !connectorRow) return finalizeFailure(sb, params.tenantId, params.connectorId, "connector_not_found");
  if (connectorRow.sync_enabled !== true || !connectorRow.sync_operation_key) {
    return finalizeFailure(sb, params.tenantId, params.connectorId, "sync_not_configured");
  }

  const { data: operationRow, error: operationError } = await sb.from("external_api_operations")
    .select("*").eq("tenant_id", params.tenantId).eq("connector_id", params.connectorId)
    .eq("operation_key", String(connectorRow.sync_operation_key)).eq("enabled", true).maybeSingle();
  if (operationError || !operationRow) return finalizeFailure(sb, params.tenantId, params.connectorId, "sync_operation_not_found");

  let credential: Record<string, string> | null = null;
  try {
    if (connectorRow.auth_type === "oauth2_client_credentials") {
      const authConfig = connectorRow.auth_config && typeof connectorRow.auth_config === "object" ? connectorRow.auth_config as Row : {};
      const secret = connectorRow.credential_ciphertext ? decryptExternalApiCredential(String(connectorRow.credential_ciphertext)) : null;
      if (!secret?.token || !authConfig.tokenUrl || !authConfig.clientId) {
        return finalizeFailure(sb, params.tenantId, params.connectorId, "oauth_config_incomplete");
      }
      const accessToken = await getValidOAuthAccessToken({
        connectorId: params.connectorId, tenantId: params.tenantId,
        tokenUrl: String(authConfig.tokenUrl), clientId: String(authConfig.clientId), clientSecret: secret.token,
      });
      credential = { token: accessToken };
    } else if (connectorRow.auth_type !== "none") {
      credential = connectorRow.credential_ciphertext ? decryptExternalApiCredential(String(connectorRow.credential_ciphertext)) : null;
      if (!credential) return finalizeFailure(sb, params.tenantId, params.connectorId, "credentials_unavailable");
    }
  } catch (error) {
    return finalizeFailure(sb, params.tenantId, params.connectorId, error instanceof Error ? error.message : "auth_failed");
  }

  const operation: ExternalApiOperationInput = {
    operationKey: String(operationRow.operation_key), name: String(operationRow.name), description: String(operationRow.description ?? ""),
    method: "GET", pathTemplate: String(operationRow.path_template),
    parameters: Array.isArray(operationRow.parameters) ? operationRow.parameters as ExternalApiOperationInput["parameters"] : [],
    responseMapping: (operationRow.response_mapping ?? {}) as ExternalApiOperationInput["responseMapping"],
    cacheTtlSeconds: 0, enabled: true,
  };
  const pagination = operationRow.pagination && typeof operationRow.pagination === "object" ? operationRow.pagination as Row : { mode: "none" };
  const mode = pagination.mode === "page_param" || pagination.mode === "cursor_param" ? pagination.mode : "none";
  const maxPages = Number.isFinite(Number(pagination.maxPages)) && Number(pagination.maxPages) > 0 ? Number(pagination.maxPages) : 10;
  const pageSize = Number.isFinite(Number(pagination.pageSize)) && Number(pagination.pageSize) > 0 ? Number(pagination.pageSize) : DEFAULT_PAGE_SIZE;

  let itemCount = 0;
  let cursor: string | null = null;

  try {
    const totalPages = mode === "none" ? 1 : maxPages;
    for (let page = 1; page <= totalPages; page += 1) {
      if (Date.now() - startedAt > SYNC_TIME_BUDGET_MS) break;

      const args: Record<string, string | number | boolean> = {};
      if (mode === "page_param" && typeof pagination.pageParam === "string") args[pagination.pageParam] = page;
      if (mode === "page_param" && typeof pagination.pageSizeParam === "string") args[pagination.pageSizeParam] = pageSize;
      if (mode === "cursor_param" && cursor && typeof pagination.pageParam === "string") args[pagination.pageParam] = cursor;

      const request = buildExternalApiRequest({
        baseUrl: String(connectorRow.base_url), operation, args,
        authType: connectorRow.auth_type as "none" | "bearer" | "api_key" | "basic" | "oauth2_client_credentials",
        authHeaderName: typeof connectorRow.auth_header_name === "string" ? connectorRow.auth_header_name : null,
        credential,
      });
      const response = await executeExternalApiHttpRequest({ ...request, method: "GET" });
      const normalized = normalizeExternalApiResponse(response.payload, operation.responseMapping);
      if (normalized.records.length === 0) break;

      const now = new Date().toISOString();
      const upsertRows = normalized.records
        .filter((record) => record.id != null && String(record.id).trim())
        .map((record) => ({
          tenant_id: params.tenantId,
          connector_id: params.connectorId,
          external_id: String(record.id).trim().slice(0, 300),
          title: record.title,
          price: typeof record.price === "number" ? record.price : Number(record.price) || null,
          currency: record.currency,
          availability: record.availability == null ? null : String(record.availability),
          link: record.link,
          media: record.media,
          attributes: record.attributes,
          is_active: true,
          last_synced_at: now,
          updated_at: now,
        }));
      if (upsertRows.length) {
        const { error: upsertError } = await sb.from("external_api_catalog_items")
          .upsert(upsertRows, { onConflict: "tenant_id,connector_id,external_id" });
        if (upsertError) throw new Error(`catalog_upsert:${upsertError.message}`);
        itemCount += upsertRows.length;
      }

      if (mode === "cursor_param") {
        const nextCursor = readJsonPath(response.payload, pagination.cursorPath as string | undefined);
        if (nextCursor == null || nextCursor === "") break;
        cursor = String(nextCursor);
      } else if (mode === "none") {
        break;
      }
    }

    // Sumiu do fornecedor nesta passada — nunca DELETE, só inativa. Molde:
    // reconcileMetaFormMappingsWithRules (lib/server/lead-rules-meta-sync.ts),
    // mesma forma de "monta o visto agora, diferença vira ação".
    const { error: inactivateError } = await sb.from("external_api_catalog_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", params.tenantId).eq("connector_id", params.connectorId)
      .eq("is_active", true).lt("last_synced_at", syncStartedIso);
    if (inactivateError) {
      console.warn("[external-api-catalog-sync] inactivate_failed", { connector_id: params.connectorId, error: inactivateError.message });
    }

    await sb.from("external_api_connectors").update({
      last_sync_at: new Date().toISOString(), last_sync_status: "success", last_sync_error: null, last_sync_item_count: itemCount,
    }).eq("tenant_id", params.tenantId).eq("id", params.connectorId);
    void logExternalApiConnectorAudit({ tenantId: params.tenantId, connectorId: params.connectorId, action: "sync_completed", detail: { itemCount } });
    return { ok: true, itemCount };
  } catch (error) {
    return finalizeFailure(sb, params.tenantId, params.connectorId, error instanceof Error ? error.message : "sync_failed");
  }
}

/** Conectores com sync ligado e frequência vencida — usado pelo cron. */
async function listConnectorsDueForSync(sb: ServiceClient, limit: number): Promise<Row[]> {
  const { data, error } = await sb.from("external_api_connectors")
    .select("id, tenant_id, sync_frequency_minutes, last_sync_at")
    .eq("sync_enabled", true).eq("enabled", true).limit(500);
  if (error || !data) return [];
  const now = Date.now();
  return (data as Row[])
    .filter((row) => {
      const frequency = Number(row.sync_frequency_minutes);
      if (!Number.isFinite(frequency) || frequency <= 0) return false;
      const lastSync = row.last_sync_at ? new Date(String(row.last_sync_at)).getTime() : 0;
      return now - lastSync >= frequency * 60_000;
    })
    .slice(0, limit);
}

/** Processa os conectores vencidos, numa passada com orçamento de tempo — usado pelo cron interno. */
export async function processDueExternalApiCatalogSyncs(
  sb: ServiceClient,
  options: { limit?: number } = {},
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const due = await listConnectorsDueForSync(sb, options.limit ?? 20);
  let succeeded = 0;
  let failed = 0;
  const batchStartedAt = Date.now();
  for (const row of due) {
    if (Date.now() - batchStartedAt > SYNC_TIME_BUDGET_MS) break;
    const result = await syncExternalApiConnectorCatalog({ sb, tenantId: String(row.tenant_id), connectorId: String(row.id) });
    if (result.ok) succeeded += 1; else failed += 1;
  }
  return { processed: succeeded + failed, succeeded, failed };
}
