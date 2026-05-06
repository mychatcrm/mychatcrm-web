#!/usr/bin/env node
/**
 * Checklist local / CI para o hub IA: variáveis Supabase + OpenAI sem imprimir segredos.
 * Lê .env.local se existir e sobrepõe process.env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadDotEnv(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return {};
  const text = fs.readFileSync(p, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[key] = v;
  }
  return env;
}

function decodeJwtRole(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) return { kind: "opaque" };
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const role = JSON.parse(json).role;
    return { kind: "jwt", role: role || null };
  } catch {
    return { kind: "invalid" };
  }
}

const fileEnv = loadDotEnv(".env.local");
const env = { ...fileEnv, ...process.env };

const issues = [];
const notes = [];
let ok = true;

const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if (!url) {
  issues.push("NEXT_PUBLIC_SUPABASE_URL ausente");
  ok = false;
} else if (!/^https:\/\/.+\.supabase\.co$/i.test(url)) {
  issues.push("NEXT_PUBLIC_SUPABASE_URL deve ser https://<ref>.supabase.co");
  ok = false;
}

const srv = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!srv) {
  issues.push("SUPABASE_SERVICE_ROLE_KEY ausente");
  ok = false;
} else if (srv.startsWith("sb_secret_")) {
  notes.push(
    "SUPABASE_SERVICE_ROLE_KEY: formato sb_secret_* (secret Supabase nova). O runtime aceita; confirme no dashboard que é a secret de serviço do projecto (não a publishable).",
  );
} else {
  const dec = decodeJwtRole(srv);
  if (dec.kind === "jwt" && dec.role !== "service_role") {
    issues.push(
      `SUPABASE_SERVICE_ROLE_KEY: JWT com role "${dec.role}" — use service_role ou sb_secret_* (nunca anon nesta variável).`,
    );
    ok = false;
  }
  if (dec.kind === "invalid") {
    issues.push("SUPABASE_SERVICE_ROLE_KEY: JWT ilegível ou string inválida (não é sb_secret_*).");
    ok = false;
  }
}

const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!anon) {
  issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY ausente (browser / RLS)");
  ok = false;
} else {
  if (anon.startsWith("sb_secret_")) {
    issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY não pode ser sb_secret_* — use a chave anon/publishable.");
    ok = false;
  } else {
    const adec = decodeJwtRole(anon);
    if (adec.kind === "jwt" && adec.role === "service_role") {
      issues.push(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY parece ser JWT service_role — chaves trocadas com SUPABASE_SERVICE_ROLE_KEY.",
      );
      ok = false;
    }
    if (adec.kind === "jwt" && adec.role && adec.role !== "anon") {
      issues.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY: role JWT "${adec.role}" (esperado anon).`);
      ok = false;
    }
    if (adec.kind === "invalid") {
      issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: JWT ilegível.");
      ok = false;
    }
  }
}

if (anon && srv && anon === srv) {
  issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são iguais — não pode.");
  ok = false;
}

if (!env.OPENAI_API_KEY?.trim()) {
  issues.push("OPENAI_API_KEY ausente (inferência e teste de ligação no servidor)");
  ok = false;
}

if (!env.OPENAI_ADMIN_API_KEY?.trim()) {
  notes.push(
    "OPENAI_ADMIN_API_KEY opcional: sem ela, o bloco «OpenAI Platform · billing» pode ficar vazio com chaves sk-proj-* (403 nas rotas de custos).",
  );
}

console.log("[verify:ia-hub-env]", ok ? "PASS" : "FAIL");
for (const i of issues) console.log(" -", i);
for (const n of notes) console.log(" ·", n);
process.exit(ok ? 0 : 1);
