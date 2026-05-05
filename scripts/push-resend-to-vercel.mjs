#!/usr/bin/env node
/**
 * Define RESEND_API_KEY no projeto Vercel ligado (Production + Preview + Development),
 * usando o token do CLI. Assim `*.vercel.app` (Preview) e produção enviam e-mail.
 *
 * Pré-requisitos:
 *   - `vercel link` na raiz (existe .vercel/project.json)
 *   - `vercel login` nesta máquina
 *
 * Uso:
 *   npm run resend:push-vercel -- 're_xxxxxxxx'
 *
 * Depois: redeploy (ou próximo push) para carregar a variável nos deploys já existentes.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const projectPath = join(root, ".vercel", "project.json");

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

async function listProjectEnvs({ token, projectId, teamId }) {
  const u = new URL(`https://api.vercel.com/v9/projects/${projectId}/env`);
  if (teamId) u.searchParams.set("teamId", teamId);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`List env failed ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body.envs ?? body;
}

async function removeEnv({ token, projectId, teamId, envId }) {
  const u = new URL(`https://api.vercel.com/v9/projects/${projectId}/env/${envId}`);
  if (teamId) u.searchParams.set("teamId", teamId);
  const res = await fetch(u, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) {
    const t = await res.text().catch(() => "");
    throw new Error(`Remove env ${envId} failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

async function createEnv({ token, projectId, teamId, key, value, target }) {
  const u = new URL(`https://api.vercel.com/v10/projects/${projectId}/env`);
  if (teamId) u.searchParams.set("teamId", teamId);
  const res = await fetch(u, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target,
      comment: "Resend — recuperação de senha (automático)",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Create env failed ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function main() {
  const value = process.argv[2]?.trim();
  if (!value || !value.startsWith("re_")) {
    console.error("Uso: node scripts/push-resend-to-vercel.mjs 're_…'  (chave API em resend.com → API Keys)");
    process.exit(1);
  }

  if (!existsSync(projectPath)) {
    console.error("Falta .vercel/project.json — execute `vercel link` na raiz do repositório.");
    process.exit(1);
  }

  const token = readVercelToken();
  if (!token) {
    console.error("Token Vercel não encontrado. Execute `vercel login` nesta máquina.");
    process.exit(1);
  }

  const { projectId, orgId: teamId } = JSON.parse(readFileSync(projectPath, "utf8"));
  if (!projectId) {
    console.error(".vercel/project.json sem projectId.");
    process.exit(1);
  }

  const target = ["production", "preview", "development"];
  const KEY = "RESEND_API_KEY";

  const envs = await listProjectEnvs({ token, projectId, teamId });
  const list = Array.isArray(envs) ? envs : [];
  const toRemove = list.filter((e) => e.key === KEY);

  for (const e of toRemove) {
    if (e.id) {
      console.log("Removendo variável existente:", KEY, e.id, e.target);
      await removeEnv({ token, projectId, teamId, envId: e.id });
    }
  }

  const created = await createEnv({ token, projectId, teamId, key: KEY, value, target });
  console.log("OK —", KEY, "criada em", target.join(", "), created?.created?.id ? `id=${created.created.id}` : "");
  console.log("Faça redeploy (ou aguarde o próximo deploy) para os ambientes passarem a enviar e-mails.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
