import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptExternalApiCredential, encryptExternalApiCredential } from "@/lib/server/external-api-crypto";
import { isBlockedExternalApiIp, normalizedIpLiteral } from "@/lib/server/external-api-network-policy";

/** Renova com folga — nunca deixa o token vencer no meio de uma sincronização longa. */
const REFRESH_MARGIN_MS = 5 * 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 8_000;

export type ExternalApiOAuthConfig = {
  connectorId: string;
  tenantId: string;
  tokenUrl: string;
  clientId: string;
  /** Já descriptografado — quem chama busca via `decryptExternalApiCredential` do `credential_ciphertext` do conector. */
  clientSecret: string;
  scope?: string | null;
};

async function requestClientCredentialsToken(
  config: ExternalApiOAuthConfig,
): Promise<{ accessToken: string; expiresAt: string }> {
  const url = new URL(config.tokenUrl);
  if (url.protocol !== "https:") throw new Error("external_api_oauth_https_required");
  // Mesma checagem de IP literal usada no resto do módulo de API externa —
  // não intercepta DNS rebinding aqui (é POST, não passa pelo cliente HTTP
  // read-only de external-api-http.ts), mas o token_url já foi validado com
  // as mesmas regras de host bloqueado na hora de salvar o conector.
  const literalIp = normalizedIpLiteral(url.hostname);
  if (literalIp && isBlockedExternalApiIp(literalIp)) throw new Error("external_api_oauth_private_host_blocked");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...(config.scope ? { scope: config.scope } : {}),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`external_api_oauth_token_http_${response.status}`);
    const data = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!data?.access_token) throw new Error("external_api_oauth_token_missing");
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (Number(data.expires_in) > 0 ? Number(data.expires_in) : 3600) * 1000).toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Token de acesso válido pro conector — reusa o cache se faltam mais de
 * `REFRESH_MARGIN_MS` pro vencer, senão renova via `client_credentials`.
 * Espelha `getValidGoogleAccessToken` (lib/server/google-calendar.ts), mas
 * grava o token sempre criptografado — nunca texto puro.
 */
export async function getValidOAuthAccessToken(config: ExternalApiOAuthConfig): Promise<string> {
  const sb = createSupabaseServiceClient();
  const { data: cached } = await sb
    .from("external_api_oauth_tokens")
    .select("access_token_ciphertext, expires_at")
    .eq("connector_id", config.connectorId)
    .eq("tenant_id", config.tenantId)
    .maybeSingle();

  if (cached) {
    const expiresMs = new Date(cached.expires_at as string).getTime();
    if (Number.isFinite(expiresMs) && expiresMs - Date.now() > REFRESH_MARGIN_MS) {
      const decrypted = decryptExternalApiCredential(String(cached.access_token_ciphertext));
      if (decrypted?.token) return decrypted.token;
    }
  }

  const fresh = await requestClientCredentialsToken(config);
  const encrypted = encryptExternalApiCredential({ token: fresh.accessToken });
  const { error } = await sb.from("external_api_oauth_tokens").upsert(
    {
      connector_id: config.connectorId,
      tenant_id: config.tenantId,
      access_token_ciphertext: encrypted.ciphertext,
      expires_at: fresh.expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connector_id" },
  );
  if (error) console.warn("[external-api-oauth] token_cache_write_failed", { connector_id: config.connectorId, error: error.message });
  return fresh.accessToken;
}
