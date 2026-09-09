#!/usr/bin/env node
/**
 * Define quem participa do piloto de Reuniões IA (`MEETINGS_ENABLED_TENANTS`).
 *
 * A lista tem precedência sobre `MEETINGS_ENABLED`: com o módulo desligado para
 * todo mundo, só os tenants nomeados aqui enxergam o menu e passam pelo guard
 * das rotas. Dá para trocar a lista pela interface da Vercel — este script
 * existe para o piloto ser reproduzível e ficar registrado no repositório.
 *
 * Uso:
 *   node scripts/set-meetings-pilot-tenants.mjs tenant-a,tenant-b
 *
 * Depois é preciso um redeploy: variável nova não entra em deploy já publicado.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "MEETINGS_ENABLED_TENANTS";
const TARGET = ["production", "preview", "development"];

/** Lê um .env simples sem depender de dotenv (o script roda fora do Next). */
function readEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "").trim();
    if (value) out[match[1]] = value;
  }
  return out;
}

function readToken() {
  const fromEnv = process.env.VERCEL_TOKEN ?? readEnvFile(".env.local").VERCEL_TOKEN;
  if (fromEnv) return fromEnv;
  for (const candidate of [
    join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
    join(homedir(), ".config", "vercel", "auth.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      const token = parsed.token ?? parsed.access_token;
      if (typeof token === "string" && token.length > 10) return token;
    } catch {
      /* segue para o próximo candidato */
    }
  }
  return null;
}

async function api(path, { token, teamId, method = "GET", body }) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(parsed).slice(0, 400)}`);
  }
  return parsed;
}

async function main() {
  const raw = process.argv[2]?.trim();
  if (!raw) {
    console.error("Uso: node scripts/set-meetings-pilot-tenants.mjs tenant-a,tenant-b");
    process.exit(1);
  }
  const value = raw
    .split(",")
    .map((tenant) => tenant.trim())
    .filter(Boolean)
    .join(",");

  const projectFile = join(root, ".vercel", "project.json");
  if (!existsSync(projectFile)) {
    console.error("Falta .vercel/project.json — rode `vercel link` na raiz.");
    process.exit(1);
  }
  const { projectId, orgId: teamId } = JSON.parse(readFileSync(projectFile, "utf8"));
  const token = readToken();
  if (!token) {
    console.error("Token Vercel não encontrado (VERCEL_TOKEN ou `vercel login`).");
    process.exit(1);
  }

  const { envs = [] } = await api(`/v9/projects/${projectId}/env`, { token, teamId });

  for (const entry of envs.filter((item) => item.key === KEY)) {
    await api(`/v9/projects/${projectId}/env/${entry.id}`, { token, teamId, method: "DELETE" });
    console.log(`removido: ${KEY} (${entry.target?.join(", ")})`);
  }

  await api(`/v10/projects/${projectId}/env`, {
    token,
    teamId,
    method: "POST",
    body: {
      key: KEY,
      value,
      type: "encrypted",
      target: TARGET,
      comment: "Piloto do módulo de reuniões — a lista tem precedência sobre MEETINGS_ENABLED",
    },
  });

  console.log(`${KEY} = ${value}`);
  console.log("Falta o redeploy: variável nova não alcança deploy já publicado.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
