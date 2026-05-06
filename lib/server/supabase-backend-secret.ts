/**
 * Validação de credenciais Supabase no servidor.
 * Suporta JWT legacy `service_role` / `anon` e chaves opacas `sb_secret_*` (servidor) e `sb_publishable_*` (público).
 * Nunca regista nem expõe valores de chaves.
 */
import { Buffer } from "node:buffer";

let opaqueBackendCredentialLogged = false;
let publishableAnonCredentialLogged = false;

function logOpaqueBackendCredentialOnce(): void {
  if (opaqueBackendCredentialLogged) return;
  opaqueBackendCredentialLogged = true;
  console.info(
    "[supabase/server] SUPABASE_SERVICE_ROLE_KEY: formato secret Supabase (sb_secret_*). Validação local de JWT omitida; permissões efectivas vêm da API Supabase.",
  );
}

function logPublishableAnonCredentialOnce(): void {
  if (publishableAnonCredentialLogged) return;
  publishableAnonCredentialLogged = true;
  console.info(
    "[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY: formato publishable (sb_publishable_*). Validação local de JWT omitida.",
  );
}

/** URL do projecto (Settings → API). */
export function assertSupabaseProjectUrl(url: string): void {
  const u = url.trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(u)) {
    throw new Error(
      "[supabase/server] NEXT_PUBLIC_SUPABASE_URL inválida. Use https://<project-ref>.supabase.co (Supabase → Settings → API).",
    );
  }
}

/**
 * Impede colar a mesma string em anon (público) e em service (servidor).
 */
export function assertSupabaseKeysNotSwapped(): void {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!anon || !svc) return;
  if (anon === svc) {
    throw new Error(
      "[supabase/server] SUPABASE_SERVICE_ROLE_KEY não pode ser igual a NEXT_PUBLIC_SUPABASE_ANON_KEY. Use a chave pública «anon» no browser e a secret de serviço (JWT service_role ou sb_secret_*) só no servidor.",
    );
  }
}

/**
 * Secret usada em `createClient` com privilégios administrativos (PostgREST).
 * Aceita: `sb_secret_*` (nova API) ou JWT com `role: service_role` (legacy).
 */
export function assertSupabaseBackendSecretKeyForServiceClient(apiKey: string): void {
  const k = apiKey.trim();

  if (k.startsWith("sb_secret_")) {
    logOpaqueBackendCredentialOnce();
    return;
  }

  const parts = k.split(".");
  if (parts.length !== 3) {
    throw new Error(
      "[supabase/server] SUPABASE_SERVICE_ROLE_KEY inválida: use a secret **service_role** (JWT) ou a secret **sb_secret_*** (Supabase → Settings → API). Não use texto arbitrário nem a chave pública anon nesta variável.",
    );
  }

  let role: string | undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    role = (JSON.parse(json) as { role?: string }).role;
  } catch {
    throw new Error(
      "[supabase/server] SUPABASE_SERVICE_ROLE_KEY: JWT ilegível. Copie de novo a secret service_role ou use uma secret sb_secret_* do mesmo projecto.",
    );
  }

  if (role !== "service_role") {
    throw new Error(
      `[supabase/server] SUPABASE_SERVICE_ROLE_KEY tem role JWT "${role ?? "desconhecida"}" (necessário service_role). Não coloque a chave anon em SUPABASE_SERVICE_ROLE_KEY.`,
    );
  }
}

/**
 * Chave pública para o browser / RLS. Nunca `service_role` nem `sb_secret_*`.
 */
export function assertSupabaseAnonPublicKeyForBrowser(apiKey: string): void {
  const k = apiKey.trim();
  if (k.startsWith("sb_secret_")) {
    throw new Error(
      "[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY não pode ser sb_secret_* (secret de serviço). Use a chave anon / publishable do separador API.",
    );
  }

  if (k.startsWith("sb_publishable_")) {
    logPublishableAnonCredentialOnce();
    return;
  }

  const parts = k.split(".");
  if (parts.length !== 3) {
    throw new Error(
      "[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY inválida: esperado o JWT anon/publishable do Supabase.",
    );
  }

  let role: string | undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    role = (JSON.parse(json) as { role?: string }).role;
  } catch {
    throw new Error("[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY: JWT ilegível.");
  }

  if (role === "service_role") {
    throw new Error(
      "[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY tem role service_role — chaves trocadas. A secret privilegiada fica só em SUPABASE_SERVICE_ROLE_KEY no servidor.",
    );
  }

  if (role !== "anon") {
    throw new Error(
      `[supabase/server] NEXT_PUBLIC_SUPABASE_ANON_KEY: role JWT "${role ?? "?"}" inesperada. Use a chave «anon» / «public» (não a secret de serviço).`,
    );
  }
}
