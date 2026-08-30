import "server-only";

import { createHash } from "node:crypto";
import type { AgentExternalApiLookupRequest, AgentExternalApiLookupResult, ExternalApiOperationInput } from "@/lib/external-api/types";
import { decryptExternalApiCredential } from "@/lib/server/external-api-crypto";
import { ExternalApiRequestError, buildExternalApiRequest, executeExternalApiHttpRequest } from "@/lib/server/external-api-http";
import { normalizeExternalApiResponse } from "@/lib/server/external-api-normalize";
import { listExternalApiConnectors } from "@/lib/server/external-api-connectors";
import { queryExternalApiCatalog } from "@/lib/server/external-api-catalog";
import { getValidOAuthAccessToken } from "@/lib/server/external-api-oauth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const hashArgs = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function listAgentExternalApiTools(tenantId: string, agentId: string) {
  const { connectors } = await listExternalApiConnectors(tenantId);
  const { data, error } = await createSupabaseServiceClient().from("agent_external_api_connectors")
    .select("connector_id").eq("tenant_id", tenantId).eq("agent_id", agentId);
  if (error) throw new Error(`[external-api] tools:${error.message}`);
  const linked = new Set(((data ?? []) as Row[]).map((row) => String(row.connector_id)));
  return connectors.filter((connector) => linked.has(connector.id) && connector.enabled && connector.effective).map((connector) => ({
    id: connector.id, name: connector.name, description: connector.description,
    operations: connector.operations.filter((operation) => operation.enabled).map((operation) => ({
      operationKey: operation.operationKey, name: operation.name, description: operation.description,
      parameters: operation.parameters.map(({ name, type, required, description }) => ({ name, type, required, description })),
    })),
  }));
}

function externalApiErrorCode(error: unknown): string {
  if (error instanceof ExternalApiRequestError) {
    const code = error.code.split(":")[0]!;
    if (code === "external_api_private_ip_blocked") return "private_network_blocked";
    if (code === "external_api_timeout") return "timeout";
    if (code === "external_api_http_error") return `http_${error.httpStatus ?? "error"}`;
    if (code === "external_api_missing_argument") return "missing_argument";
    return code.startsWith("external_api_") ? code.slice(13) : code;
  }
  const value = error instanceof Error ? error.message : "external_api_failed";
  if (value.startsWith("external_api_missing_argument")) return "missing_argument";
  if (value.includes("timeout")) return "timeout";
  if (value.includes("private")) return "private_network_blocked";
  if (value.includes("rate_limit")) return "rate_limited";
  return value.startsWith("external_api_") ? value.slice(13) : "request_failed";
}

/** Status HTTP real da falha, quando existe — pra log e pra UI explicarem o que aconteceu, não só um código genérico. */
function externalApiErrorHttpStatus(error: unknown): number | null {
  return error instanceof ExternalApiRequestError ? error.httpStatus : null;
}

export async function executeAgentExternalApiLookup(params: {
  tenantId: string; agentId: string | null; request: AgentExternalApiLookupRequest; skipAgentAuthorization?: boolean;
}): Promise<AgentExternalApiLookupResult> {
  const startedAt = Date.now();
  const sb = createSupabaseServiceClient();
  let connectorName = "API externa";
  let operationName = params.request.operationKey;
  let connectorRow: Row | null = null;
  let operationRow: Row | null = null;
  try {
    const { connectors } = await listExternalApiConnectors(params.tenantId);
    const connector = connectors.find((item) => item.id === params.request.connectorId);
    if (!connector || !connector.enabled || !connector.effective) throw new Error("external_api_not_available");
    connectorName = connector.name;
    if (!params.skipAgentAuthorization) {
      if (!params.agentId) throw new Error("external_api_agent_not_linked");
      const { data: link } = await sb.from("agent_external_api_connectors").select("connector_id")
        .eq("tenant_id", params.tenantId).eq("agent_id", params.agentId).eq("connector_id", connector.id).maybeSingle();
      if (!link) throw new Error("external_api_agent_not_linked");
    }
    const connectorResult = await sb.from("external_api_connectors").select("*").eq("tenant_id", params.tenantId).eq("id", connector.id).single();
    if (connectorResult.error) throw connectorResult.error;
    connectorRow = connectorResult.data as Row;
    const operationResult = await sb.from("external_api_operations").select("*").eq("tenant_id", params.tenantId)
      .eq("connector_id", connector.id).eq("operation_key", params.request.operationKey).eq("enabled", true).maybeSingle();
    if (operationResult.error) throw operationResult.error;
    operationRow = operationResult.data as Row | null;
    if (!operationRow) throw new Error("external_api_operation_not_found");
    operationName = String(operationRow.name);

    // Conector com catálogo sincronizado: lê a tabela interna (barata, sem
    // limite de chamada externo pra respeitar) em vez de chamar o fornecedor
    // ao vivo. Sem sync, segue exatamente o caminho de sempre abaixo.
    if (connectorRow.sync_enabled === true) {
      const parameters = Array.isArray(operationRow.parameters) ? operationRow.parameters as ExternalApiOperationInput["parameters"] : [];
      const normalized = await queryExternalApiCatalog({
        tenantId: params.tenantId, connectorId: connector.id, operationKey: params.request.operationKey,
        parameters, arguments: params.request.arguments,
      });
      await sb.from("external_api_call_logs").insert({
        tenant_id: params.tenantId, connector_id: connector.id, operation_id: String(operationRow.id),
        agent_id: params.agentId, status: "success", latency_ms: Date.now() - startedAt,
        result_count: normalized.records.length,
        args_hash: hashArgs(Object.fromEntries(params.request.arguments.slice(0, 20).map((item) => [item.name, item.value]))),
      });
      return { connectorId: connector.id, connectorName, operationKey: params.request.operationKey, operationName, ok: true, data: normalized };
    }

    const { data: allowed, error: rateError } = await sb.rpc("consume_external_api_rate_limit", {
      p_tenant_id: params.tenantId, p_connector_id: connector.id, p_limit: 60, p_window_seconds: 60,
    });
    const rateDecision = Array.isArray(allowed) ? allowed[0] as { allowed?: boolean } | undefined : allowed as { allowed?: boolean } | null;
    if (rateError || rateDecision?.allowed !== true) throw new Error("external_api_rate_limit");
    const args = Object.fromEntries(params.request.arguments.slice(0, 20).map((item) => [item.name, item.value]));
    const argsHash = hashArgs(args);
    const cacheTtl = Number(operationRow.cache_ttl_seconds ?? 0);
    if (cacheTtl > 0) {
      const { data: cached } = await sb.from("external_api_cache").select("normalized_result")
        .eq("tenant_id", params.tenantId).eq("connector_id", connector.id).eq("operation_id", String(operationRow.id))
        .eq("cache_key", argsHash).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (cached?.normalized_result) return { connectorId: connector.id, connectorName, operationKey: params.request.operationKey, operationName, ok: true, data: cached.normalized_result };
    }
    let credential: Record<string, string> | null = null;
    if (connectorRow.auth_type === "oauth2_client_credentials") {
      const authConfig = connectorRow.auth_config && typeof connectorRow.auth_config === "object" ? connectorRow.auth_config as Row : {};
      const clientSecret = connectorRow.credential_ciphertext ? decryptExternalApiCredential(String(connectorRow.credential_ciphertext)) : null;
      if (!clientSecret?.token || !authConfig.tokenUrl || !authConfig.clientId) throw new Error("external_api_credentials_unavailable");
      const accessToken = await getValidOAuthAccessToken({
        connectorId: connector.id, tenantId: params.tenantId,
        tokenUrl: String(authConfig.tokenUrl), clientId: String(authConfig.clientId), clientSecret: clientSecret.token,
      });
      credential = { token: accessToken };
    } else if (connectorRow.auth_type !== "none") {
      credential = connectorRow.credential_ciphertext ? decryptExternalApiCredential(String(connectorRow.credential_ciphertext)) : null;
      if (!credential) throw new Error("external_api_credentials_unavailable");
    }
    const operation: ExternalApiOperationInput = {
      operationKey: String(operationRow.operation_key), name: String(operationRow.name), description: String(operationRow.description ?? ""),
      method: operationRow.method === "GET" ? "GET" : "POST", pathTemplate: String(operationRow.path_template),
      parameters: Array.isArray(operationRow.parameters) ? operationRow.parameters as ExternalApiOperationInput["parameters"] : [],
      responseMapping: operationRow.response_mapping as ExternalApiOperationInput["responseMapping"],
      cacheTtlSeconds: [30, 60, 120, 300].includes(cacheTtl) ? cacheTtl as 30 | 60 | 120 | 300 : 0, enabled: true,
    };
    const request = buildExternalApiRequest({ baseUrl: String(connectorRow.base_url), operation, args,
      authType: connectorRow.auth_type as "none" | "bearer" | "api_key" | "basic" | "oauth2_client_credentials",
      authHeaderName: typeof connectorRow.auth_header_name === "string" ? connectorRow.auth_header_name : null, credential });
    if (operation.method !== "GET") throw new ExternalApiRequestError("external_api_read_only_method_required");
    // executeExternalApiHttpRequest já segue redirects e só devolve aqui uma
    // resposta 2xx com JSON válido — qualquer outra coisa já veio como
    // ExternalApiRequestError, com o status HTTP real preservado.
    const response = await executeExternalApiHttpRequest({ ...request, method: "GET" });
    const normalized = normalizeExternalApiResponse(response.payload, operation.responseMapping);
    if (cacheTtl > 0) await sb.from("external_api_cache").upsert({ tenant_id: params.tenantId, connector_id: connector.id,
      operation_id: String(operationRow.id), cache_key: argsHash, normalized_result: normalized,
      expires_at: new Date(Date.now() + cacheTtl * 1000).toISOString() }, { onConflict: "tenant_id,connector_id,operation_id,cache_key" });
    await Promise.all([
      sb.from("external_api_call_logs").insert({ tenant_id: params.tenantId, connector_id: connector.id, operation_id: String(operationRow.id),
        agent_id: params.agentId, status: "success", http_status: response.status, latency_ms: Date.now() - startedAt,
        result_count: normalized.records.length, args_hash: argsHash }),
      sb.from("external_api_connectors").update({ health_status: "healthy", last_health_at: new Date().toISOString(), last_error_code: null }).eq("id", connector.id).eq("tenant_id", params.tenantId),
    ]);
    return { connectorId: connector.id, connectorName, operationKey: params.request.operationKey, operationName, ok: true, data: normalized };
  } catch (error) {
    const errorCode = externalApiErrorCode(error);
    const httpStatus = externalApiErrorHttpStatus(error);
    await Promise.all([
      sb.from("external_api_call_logs").insert({ tenant_id: params.tenantId, connector_id: params.request.connectorId,
        operation_id: operationRow?.id ?? null, agent_id: params.agentId, status: "error", http_status: httpStatus,
        latency_ms: Date.now() - startedAt, error_code: errorCode, args_hash: hashArgs(params.request.arguments) }),
      // Antes só o sucesso atualizava isto — a falha ficava invisível fora de
      // um alert() passageiro no botão "Testar". Agora o card na tela mostra
      // o último erro real, mesmo que ninguém tenha clicado "Testar" de novo.
      sb.from("external_api_connectors").update({ health_status: "error", last_health_at: new Date().toISOString(), last_error_code: errorCode })
        .eq("id", params.request.connectorId).eq("tenant_id", params.tenantId),
    ]);
    return { connectorId: params.request.connectorId, connectorName, operationKey: params.request.operationKey, operationName, ok: false, errorCode, httpStatus };
  }
}
