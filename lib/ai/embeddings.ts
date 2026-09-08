import "server-only";

import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { integrationLog } from "@/lib/integrations/logger";

/**
 * Embeddings para a busca entre reuniões.
 *
 * `text-embedding-3-small` tem 1536 dimensões — exatamente a coluna já usada em
 * `agent_knowledge_chunks`, então o formato do schema já está validado em
 * produção.
 *
 * Diferente do embedding local por feature hashing que existe no projeto: aquele
 * casa palavras, e aqui a pergunta é semântica ("quem falou sobre contratar
 * gente" tem de achar "precisamos de mais dois vendedores").
 */
const MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH = 96;
const MAX_CHARS_PER_INPUT = 8000;

/** US$ por 1M de tokens (out/2026). Usado só para estimar custo no admin. */
export const EMBEDDING_USD_PER_1M_TOKENS = 0.02;

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const inputs = texts
    .map((text) => text.trim().slice(0, MAX_CHARS_PER_INPUT))
    .filter((text) => text.length > 0);
  if (inputs.length === 0) return [];
  if (inputs.length > MAX_BATCH) throw new Error("embedding_batch_too_large");

  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, input: inputs }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    integrationLog("openai", "warn", "embedding fetch failed", {
      detail: error instanceof Error ? error.message.slice(0, 120) : undefined,
    });
    return null;
  }

  if (!response.ok) {
    integrationLog("openai", "error", "embedding request failed", { status: response.status });
    return null;
  }

  const json = (await response.json().catch(() => null)) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  } | null;
  if (!json?.data) return null;

  // A API garante a ordem, mas ordenar pelo índice torna isso explícito: um
  // vetor no lugar errado associaria o trecho de uma reunião ao texto de outra.
  const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = sorted.map((entry) => entry.embedding ?? []);

  if (vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
    integrationLog("openai", "error", "embedding dimension mismatch", {});
    return null;
  }
  return vectors;
}

export async function embedQuery(query: string): Promise<number[] | null> {
  const vectors = await embedTexts([query]);
  return vectors?.[0] ?? null;
}
