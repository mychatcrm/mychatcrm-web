#!/usr/bin/env node
/**
 * Obtém a secret de serviço do Supabase (Management API) e grava em SUPABASE_SERVICE_ROLE_KEY na Vercel.
 *
 * Pré-requisitos:
 *   - `vercel link` + `vercel login`
 *   - SUPABASE_ACCESS_TOKEN (PAT em https://supabase.com/dashboard/account/tokens)
 *     OU passar a chave directamente: node scripts/push-supabase-service-role-to-vercel.mjs 'eyJ...'|'sb_secret_...'
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/push-supabase-service-role-to-vercel.mjs
 *   node scripts/push-supabase-service-role-to-vercel.mjs 'sb_secret_...'
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const projectPath = join(root, ".vercel", "project.json");
const SUPABASE_REF = "nfubritofflnlcorxljt";
const ENV_KEY = "SUPABASE_SERVICE_ROLE_KEY";

function readVercelToken() {
  const candidates = [
    join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
    join(homedir(), ".config", "vercel", "auth.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const t = j.token ?? j.access_token;
      if (typeof t === "string" && t.length > 10) return t;
    } catch {
      /* skip */
    }
  }
  return null;
}

function decodeJwtRole(jwt) {
  try {
    const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8")).role;
  } catch {
    return null;
  }
}

function classifyKey(k) {
  const t = k.trim();
  if (t.startsWith("sb_secret_")) return "sb_secret";
  if (t.split(".").length === 3) return `jwt:${decodeJwtRole(t) ?? "?"}`;
  return "unknown";
}

async function fetchServiceRoleFromManagementApi(accessToken) {
  const url = `https://api.supabase.com/v1/projects/${SUPABASE_REF}/api-keys?reveal=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Supabase Management API ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  const keys = Array.isArray(body) ? body : body?.data ?? [];
  const secret =
    keys.find((k) => k.type === "secret" && k.api_key && !k.disabled) ??
    keys.find((k) => k.name === "service_role" && k.api_key) ??
    keys.find((k) => k.type === "legacy" && k.name === "service_role" && k.api_key);
  if (!secret?.api_key) {
    throw new Error(
      "Nenhuma secret service_role/sb_secret encontrada. Crie uma em Settings → API Keys no dashboard Supabase.",
    );
  }
  return secret.api_key.trim();
}

async function createNewSecretKey(accessToken) {
  const url = `https://api.supabase.com/v1/projects/${SUPABASE_REF}/api-keys?reveal=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "secret",
      name: "mychatcrm-vercel-" + new Date().toISOString().slice(0, 10),
      description: "Secret de serviço para Vercel (MyChatCRM)",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Create API key failed ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  const key = (body.api_key ?? body?.data?.api_key ?? "").trim();
  if (!key) throw new Error("Create API key: resposta sem api_key");
  return key;
}

async function verifyKeyWorks(serviceKey) {
  const envPath = join(root, ".env.local");
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url && existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m);
    if (m) url = m[1].replace(/^["']|["']$/g, "").trim();
  }
  url = url || `https://${SUPABASE_REF}.supabase.co`;
  const probe = await fetch(`${url.replace(/\/$/, "")}/rest/v1/meta_connections?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (probe.status === 401 || probe.status === 403) {
    const t = await probe.text().catch(() => "");
    throw new Error(`Chave rejeitada pelo PostgREST (${probe.status}): ${t.slice(0, 200)}`);
  }
  return true;
}

async function listProjectEnvs({ token, projectId, teamId }) {
  const u = new URL(`https://api.vercel.com/v10/projects/${projectId}/env`);
  u.searchParams.set("decrypt", "true");
  if (teamId) u.searchParams.set("teamId", teamId);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`List env failed ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body.envs ?? [];
}

async function removeEnv({ token, projectId, teamId, envId }) {
  const u = new URL(`https://api.vercel.com/v9/projects/${projectId}/env/${envId}`);
  if (teamId) u.searchParams.set("teamId", teamId);
  await fetch(u, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

async function upsertEnv({ token, projectId, teamId, key, value, target }) {
  const envs = await listProjectEnvs({ token, projectId, teamId });
  for (const e of envs.filter((x) => x.key === key)) {
    if (e.id) await removeEnv({ token, projectId, teamId, envId: e.id });
  }
  const u = new URL(`https://api.vercel.com/v10/projects/${projectId}/env`);
  if (teamId) u.searchParams.set("teamId", teamId);
  const res = await fetch(u, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target,
      comment: "Supabase service role — push-supabase-service-role-to-vercel",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Create ${key} failed ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
}

async function resolveServiceKey(argvKey) {
  if (argvKey?.trim()) return argvKey.trim();
  const pat = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!pat) {
    throw new Error(
      "Forneça a chave como argumento ou defina SUPABASE_ACCESS_TOKEN (PAT Supabase).",
    );
  }
  try {
    return await fetchServiceRoleFromManagementApi(pat);
  } catch (e) {
    console.warn("List api-keys falhou, a criar nova secret key…", e.message || e);
    return await createNewSecretKey(pat);
  }
}

async function main() {
  const argvKey = process.argv[2];
  if (!existsSync(projectPath)) {
    console.error("Falta .vercel/project.json — execute vercel link.");
    process.exit(1);
  }
  const vercelToken = readVercelToken();
  if (!vercelToken) {
    console.error("Token Vercel não encontrado. Execute vercel login.");
    process.exit(1);
  }

  const serviceKey = await resolveServiceKey(argvKey);
  const kind = classifyKey(serviceKey);
  if (kind === "jwt:anon") {
    console.error("ERRO: a chave parece ser anon, não service_role.");
    process.exit(1);
  }
  if (kind === "unknown") {
    console.error("ERRO: formato de chave não reconhecido.");
    process.exit(1);
  }

  await verifyKeyWorks(serviceKey);

  const { projectId, orgId: teamId } = JSON.parse(readFileSync(projectPath, "utf8"));
  const target = ["production", "preview", "development"];
  const fingerprint = createHash("sha256").update(serviceKey).digest("hex").slice(0, 12);

  const existing = (await listProjectEnvs({ token: vercelToken, projectId, teamId })).find(
    (e) => e.key === ENV_KEY,
  );
  const existingVal = (existing?.value ?? "").trim();
  if (existingVal) {
    const same =
      existingVal === serviceKey ||
      createHash("sha256").update(existingVal).digest("hex").slice(0, 12) === fingerprint;
    if (same) {
      console.log(`OK — ${ENV_KEY} já coincide (sha256…${fingerprint}). Nada a alterar.`);
      return;
    }
    console.log(`A substituir ${ENV_KEY} (sha256 anterior ≠ ${fingerprint}).`);
  } else {
    console.log(`A criar ${ENV_KEY} (sha256…${fingerprint}).`);
  }

  await upsertEnv({
    token: vercelToken,
    projectId,
    teamId,
    key: ENV_KEY,
    value: serviceKey,
    target,
  });
  console.log(`OK — ${ENV_KEY} → ${target.join(", ")} (${kind}, len=${serviceKey.length})`);
  console.log("Execute: npx vercel --prod  (ou redeploy no dashboard) para aplicar.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
