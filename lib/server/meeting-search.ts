import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import type { AccessScope } from "@/lib/server/access-scope";
import { buildMeetingVisibilityFilter } from "@/lib/server/meeting-access-scope";
import { embedQuery } from "@/lib/ai/embeddings";
import type { NormalizedSegment } from "@/lib/server/meeting-transcription";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** ~2 min de fala por trecho: contexto suficiente para a resposta fazer sentido. */
const CHUNK_TARGET_CHARS = 1200;

export type MeetingChunkInput = {
  idx: number;
  content: string;
  startMs: number;
  endMs: number;
};

/**
 * Agrupa segmentos em trechos indexáveis.
 *
 * Indexar segmento a segmento produziria resultados sem contexto ("sim, pode
 * ser") — inúteis numa busca. Agrupar por tamanho preserva a vizinhança da
 * conversa.
 */
export function buildSearchChunks(segments: NormalizedSegment[]): MeetingChunkInput[] {
  const chunks: MeetingChunkInput[] = [];
  let buffer: string[] = [];
  let startMs = 0;
  let endMs = 0;
  let length = 0;

  const flush = () => {
    const content = buffer.join(" ").trim();
    if (content) {
      chunks.push({ idx: chunks.length, content: content.slice(0, 6000), startMs, endMs });
    }
    buffer = [];
    length = 0;
  };

  for (const segment of segments) {
    if (buffer.length === 0) startMs = segment.startMs;
    buffer.push(segment.text);
    endMs = segment.endMs;
    length += segment.text.length;
    if (length >= CHUNK_TARGET_CHARS) flush();
  }
  flush();

  return chunks;
}

export type MeetingSearchHit = {
  meetingId: string;
  meetingTitle: string;
  content: string;
  startMs: number;
  score: number;
};

/**
 * Busca no que foi dito, em todas as reuniões que a pessoa alcança.
 *
 * O recorte é resolvido ANTES da busca: a lista de reuniões visíveis vira
 * parâmetro da RPC. A função no banco não decide permissão — se a lista vier
 * vazia, ela devolve zero linhas.
 */
export async function searchMeetings(params: {
  sb: SupabaseServiceClient;
  session: ClientSession;
  scope: AccessScope;
  query: string;
  limit?: number;
}): Promise<MeetingSearchHit[]> {
  const query = params.query.trim().slice(0, 300);
  if (!query) return [];

  const filter = await buildMeetingVisibilityFilter(
    params.sb,
    params.session.tenantId,
    params.scope,
    params.session,
  );
  if (filter.kind === "none") return [];

  let idQuery = params.sb
    .from("meetings")
    .select("id, title")
    .eq("tenant_id", params.session.tenantId)
    .is("deleted_at", null)
    .in("status", ["completed", "partial"])
    .limit(500);
  if (filter.kind === "or") idQuery = idQuery.or(filter.expression);

  const { data: visible } = await idQuery;
  const rows = (visible ?? []) as unknown as Array<{ id: string; title: string }>;
  if (rows.length === 0) return [];

  const titleById = new Map(rows.map((row) => [row.id, row.title]));
  const embedding = await embedQuery(query);

  const { data, error } = await params.sb.rpc("search_meeting_chunks_v1", {
    p_tenant_id: params.session.tenantId,
    p_meeting_ids: rows.map((row) => row.id),
    p_query: query,
    // Sem embedding (chave ausente ou provedor fora), a RPC continua servindo
    // pelo ramo lexical — busca pior, mas viva.
    p_embedding: embedding,
    p_limit: params.limit ?? 20,
  });

  if (error) {
    console.error("[meeting-search] rpc failed", error.message);
    throw new Error("meeting_search_failed");
  }

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    meetingId: String(row.meeting_id),
    meetingTitle: titleById.get(String(row.meeting_id)) || "Reunião sem título",
    content: String(row.content ?? ""),
    startMs: Number(row.start_ms ?? 0),
    score: Number(row.score ?? 0),
  }));
}
