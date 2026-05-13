#!/usr/bin/env node
/**
 * Sincroniza variáveis críticas (R2, Resend, WhatsApp handoff) na Vercel.
 * Lê valores de .env.local e grava em production, preview e development.
 *
 * Uso:
 *   node scripts/sync-critical-env-to-vercel.mjs
 *   node scripts/sync-critical-env-to-vercel.mjs RESEND_API_KEY R2_ACCESS_KEY_ID ...
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const projectPath = join(root, ".vercel", "project.json");
const envLocalPath = join(root, ".env.local");

const DEFAULT_KEYS = [
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "NEXT_PUBLIC_WHATSAPP_HANDOFF",
];

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

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const k = trimmed.slice(0, i).trim();
    let v = trimmed.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
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
  const existing = envs.filter((e) => e.key === key && JSON.stringify(e.target) === JSON.stringify(target));
  for (const e of existing) {
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
      comment: "sync-critical-env-to-vercel",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Create ${key} failed ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
}

async function main() {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_KEYS;
  if (!existsSync(projectPath)) {
    console.error("Falta .vercel/project.json — execute vercel link.");
    process.exit(1);
  }
  const token = readVercelToken();
  if (!token) {
    console.error("Token Vercel não encontrado. Execute vercel login.");
    process.exit(1);
  }
  const { projectId, orgId: teamId } = JSON.parse(readFileSync(projectPath, "utf8"));
  const local = parseEnvFile(envLocalPath);
  const target = ["production", "preview", "development"];

  for (const key of keys) {
    const value = (local[key] ?? "").trim();
    if (!value) {
      console.warn(`SKIP ${key} — vazio em .env.local`);
      continue;
    }
    await upsertEnv({ token, projectId, teamId, key, value, target });
    console.log(`OK ${key} → ${target.join(", ")} (len=${value.length})`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
