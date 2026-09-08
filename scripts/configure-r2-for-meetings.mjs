#!/usr/bin/env node
/**
 * Configura o bucket R2 para o módulo de reuniões.
 *
 * Duas coisas, ambas obrigatórias para o upload em partes funcionar:
 *
 *  1. CORS com `ExposeHeaders: ["ETag"]`. Sem isso o navegador até envia a
 *     parte, mas não consegue LER o ETag da resposta — e sem o ETag de cada
 *     parte o `CompleteMultipartUpload` não fecha. O upload falha no fim, depois
 *     de gastar toda a banda do usuário.
 *
 *  2. Regra de ciclo de vida abortando multipart incompleto. Uma gravação
 *     abandonada deixa partes no bucket que NÃO aparecem na listagem de objetos
 *     e continuam sendo cobradas.
 *
 * Uso:
 *   node scripts/configure-r2-for-meetings.mjs          # aplica
 *   node scripts/configure-r2-for-meetings.mjs --check   # só mostra o estado
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    let v = trimmed.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[trimmed.slice(0, i).trim()] = v;
  }
  return out;
}

/**
 * As credenciais do R2 vivem em `.env.vercel.production` (é de lá que a Vercel
 * as recebe); `.env.local` tem as chaves declaradas mas vazias. Ler os dois, com
 * `.env.local` tendo precedência, evita o erro confuso de "faltam variáveis
 * R2_*" quando elas existem — só que no outro arquivo.
 */
/** Chave declarada e vazia não configura nada — some antes de sobrescrever. */
function withoutEmpty(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => typeof value === "string" && value.trim() !== ""),
  );
}

const env = {
  ...withoutEmpty(parseEnvFile(join(root, ".env.vercel.production"))),
  ...withoutEmpty(parseEnvFile(join(root, ".env.local"))),
  ...withoutEmpty(process.env),
};
const BUCKET = env.R2_BUCKET?.trim();
const ENDPOINT = env.R2_ENDPOINT?.trim();

if (!BUCKET || !ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
  console.error("Faltam variáveis R2_* no .env.local.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
  },
  forcePathStyle: true,
});

const ORIGINS = [
  "https://www.mychatcrm.com.br",
  "https://mychatcrm.com.br",
  "https://www.mychatcrm.com",
  "https://mychatcrm.com",
  "http://localhost:3030",
  "http://localhost:3000",
];

const CORS_RULES = [
  {
    AllowedOrigins: ORIGINS,
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["content-type"],
    // Obrigatório: o navegador só lê o ETag da parte se ele for exposto.
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

const LIFECYCLE_RULES = [
  {
    ID: "abort-incomplete-multipart-7d",
    Status: "Enabled",
    Filter: { Prefix: "" },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
  },
];

async function show(label, fn) {
  try {
    const result = await fn();
    console.log(`${label}:`, JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(`${label}: (não configurado — ${error.name})`);
  }
}

async function main() {
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    await show("CORS atual", async () =>
      (await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }))).CORSRules,
    );
    await show("Lifecycle atual", async () =>
      (await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }))).Rules,
    );
    return;
  }

  await client.send(
    new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: { CORSRules: CORS_RULES } }),
  );
  console.log(`OK  CORS aplicado em ${BUCKET} (${ORIGINS.length} origens, ETag exposto)`);

  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: BUCKET,
      LifecycleConfiguration: { Rules: LIFECYCLE_RULES },
    }),
  );
  console.log("OK  Lifecycle aplicado (multipart incompleto abortado em 7 dias)");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
