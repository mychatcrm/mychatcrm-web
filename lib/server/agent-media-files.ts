import "server-only";

import crypto from "crypto";
import {
  assertR2Configured,
  createR2PresignedUploadUrl,
  deleteR2Object,
  headR2Object,
} from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const AGENT_MEDIA_MAX_FILES = 50;
/** Limite total de armazenamento por agente (soma apenas ficheiros `ready`). */
export const AGENT_MEDIA_TOTAL_BYTES_CAP = 1024 * 1024 * 1024;
/** Evita uploads individuais demasiado grandes dentro do quota total. */
export const AGENT_MEDIA_MAX_SINGLE_FILE_BYTES = 256 * 1024 * 1024;

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentMediaFile = {
  id: string;
  tenantId: string;
  agentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  description: string | null;
  status: "uploading" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
};

function cleanAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function safeFilename(filename: string): string {
  const clean = filename
    .trim()
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, "_");
  return clean.slice(0, 160) || "arquivo";
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toRow(row: Record<string, unknown>): AgentMediaFile {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    agentId: String(row.agent_id),
    originalFilename: String(row.original_filename ?? ""),
    mimeType: String(row.mime_type ?? "application/octet-stream"),
    sizeBytes: Number(row.size_bytes ?? 0),
    storageKey: String(row.storage_key ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    status: String(row.status ?? "uploading") as AgentMediaFile["status"],
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

/** Normaliza o MIME (sem validar tipo — qualquer ficheiro é aceite). */
export function normalizeAgentMediaMimeType(raw: string): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "application/octet-stream";
  const base = t.split(";")[0]!.trim().toLowerCase();
  return base || "application/octet-stream";
}

function resolveOutboundMimeFromUpload(stored: string, headType: string | null): string {
  const h = normalizeAgentMediaMimeType(headType ?? "");
  const s = normalizeAgentMediaMimeType(stored);
  if (headType?.trim() && h !== "application/octet-stream") return h;
  if (s !== "application/octet-stream") return s;
  return h || s;
}

export type OutboundMediaDirectiveParse = {
  cleanedText: string;
  filenames: string[];
};

type AgentOutboundMediaCandidate = {
  originalFilename: string;
  mimeType: string;
  description: string | null;
};

const OUTBOUND_MEDIA_REQUEST_WORDS = [
  "anexo",
  "anexos",
  "arquivo",
  "arquivos",
  "brochure",
  "catalogo",
  "catálogo",
  "documento",
  "documentos",
  "folder",
  "foto",
  "fotos",
  "imagem",
  "imagens",
  "material",
  "materiais",
  "midia",
  "mídia",
  "pdf",
  "planta",
  "plantas",
  "tabela",
  "video",
  "vídeo",
];

const OUTBOUND_MEDIA_REFUSAL_WORDS = [
  "nao posso enviar",
  "nao consigo enviar",
  "não posso enviar",
  "não consigo enviar",
  "nao tenho como enviar",
  "não tenho como enviar",
  "nao consigo anexar",
  "não consigo anexar",
  "no puedo enviar",
  "i can't send",
  "i cannot send",
];

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  const stopwords = new Set([
    "para",
    "com",
    "uma",
    "uns",
    "das",
    "dos",
    "que",
    "por",
    "the",
    "and",
    "you",
    "can",
    "please",
  ]);
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

export function isLikelyOutboundMediaRequest(text: string): boolean {
  const normalized = normalizeSearchText(text);
  return OUTBOUND_MEDIA_REQUEST_WORDS.some((word) => normalized.includes(normalizeSearchText(word)));
}

export function looksLikeOutboundMediaRefusal(text: string): boolean {
  const normalized = normalizeSearchText(text);
  return OUTBOUND_MEDIA_REFUSAL_WORDS.some((word) => normalized.includes(normalizeSearchText(word)));
}

const MEDIA_TAG_REGEX = /\[\[ENVIAR_MEDIA:(.*?)\]\]/gi;

/** Extrai todos os nomes de arquivo das diretivas [[ENVIAR_MEDIA:...]] na ordem de aparição. */
export function extractMediaFilenames(text: string): string[] {
  const matches = [...text.matchAll(MEDIA_TAG_REGEX)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

/** Remove todas as diretivas [[ENVIAR_MEDIA:...]] do texto visível ao cliente. */
export function stripMediaTags(text: string): string {
  MEDIA_TAG_REGEX.lastIndex = 0;
  return text.replace(MEDIA_TAG_REGEX, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Remove marcadores [[ENVIAR_MEDIA:filename.ext]] enviados pelo modelo e devolve nomes na ordem.
 */
export function stripOutboundMediaDirectives(text: string): OutboundMediaDirectiveParse {
  const filenames = extractMediaFilenames(text);
  const cleanedText = stripMediaTags(text);
  return { cleanedText, filenames };
}

export async function listAgentMediaFiles(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<AgentMediaFile[]> {
  const { data, error } = await params.sb
    .from("agent_media_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Erro ao listar arquivos de mídia do agente.");
  return ((data ?? []) as Array<Record<string, unknown>>).map(toRow);
}

/** Linhas numeradas para o system prompt (`nome — descrição`). */
export async function getAgentOutboundMediaPromptLines(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<string[]> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("agent_media_files")
    .select("original_filename,description")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "ready")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[agent-media-files] outbound prompt lines", error.code, error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const name = String(row.original_filename ?? "arquivo");
    const desc = textOrNull(row.description);
    return desc ? `${name} — ${desc}` : `${name} — (sem descrição)`;
  });
}

async function listReadyAgentOutboundMediaCandidates(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<AgentOutboundMediaCandidate[]> {
  const { data, error } = await params.sb
    .from("agent_media_files")
    .select("original_filename,description,mime_type")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(AGENT_MEDIA_MAX_FILES);

  if (error) {
    console.warn("[agent-media-files] infer outbound media", error.code, error.message);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      originalFilename: String(row.original_filename ?? "").trim(),
      mimeType: normalizeAgentMediaMimeType(String(row.mime_type ?? "")),
      description: textOrNull(row.description),
    }))
    .filter((row) => row.originalFilename.length > 0);
}

function scoreOutboundMediaCandidate(candidate: AgentOutboundMediaCandidate, requestText: string): number {
  const request = normalizeSearchText(requestText);
  const haystack = normalizeSearchText(`${candidate.originalFilename} ${candidate.description ?? ""}`);
  const mime = candidate.mimeType.toLowerCase();
  let score = 0;

  const wantsImage = /\b(foto|fotos|imagem|imagens|fachada|planta|plantas)\b/.test(request);
  const wantsVideo = /\b(video|videos)\b/.test(request);
  const wantsDocument = /\b(pdf|arquivo|arquivos|documento|documentos|catalogo|folder|brochure|tabela|material|materiais)\b/.test(request);

  if (wantsImage && mime.startsWith("image/")) score += 50;
  if (wantsVideo && mime.startsWith("video/")) score += 50;
  if (wantsDocument && !mime.startsWith("image/") && !mime.startsWith("video/") && !mime.startsWith("audio/")) {
    score += 35;
  }
  if (!wantsImage && !wantsVideo && !wantsDocument) score += 5;

  const requestTokens = new Set(tokenizeSearchText(requestText));
  for (const token of requestTokens) {
    if (haystack.includes(token)) score += 10;
  }

  return score;
}

export async function inferOutboundMediaFilenamesForRequest(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  requestText: string;
  limit?: number;
}): Promise<string[]> {
  const requestText = params.requestText.trim();
  if (!requestText || !isLikelyOutboundMediaRequest(requestText)) return [];

  const sb = params.sb ?? createSupabaseServiceClient();
  const candidates = await listReadyAgentOutboundMediaCandidates({
    sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
  });
  if (!candidates.length) return [];

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreOutboundMediaCandidate(candidate, requestText),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(params.limit ?? 1, 5)))
    .map((item) => item.candidate.originalFilename);
}

export async function resolveOutboundMediaForAgentResponse(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  responseText: string;
  userRequestText: string;
}): Promise<OutboundMediaDirectiveParse & { inferred: boolean }> {
  const filenames = extractMediaFilenames(params.responseText);
  let cleanedText = stripMediaTags(params.responseText);
  if (filenames.length) {
    console.log("[MEDIA_DEBUG] directives_parsed:", { count: filenames.length, filenames });
    return { cleanedText, filenames, inferred: false };
  }

  const inferred = await inferOutboundMediaFilenamesForRequest({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    requestText: params.userRequestText,
  });
  if (!inferred.length) return { cleanedText, filenames: [], inferred: false };

  cleanedText = looksLikeOutboundMediaRefusal(cleanedText)
    ? "Claro, vou te enviar agora."
    : cleanedText.trim() || "Segue o envio solicitado.";

  console.info("[outbound-media]", {
    action: "inferred_directive",
    tenant_id: params.tenantId,
    agent_id: params.agentId,
    count: inferred.length,
  });

  return { cleanedText, filenames: inferred, inferred: true };
}

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Lookup por original_filename (ilike exacto, depois contains) para envio Evolution. */
export async function lookupReadyAgentMediaForOutbound(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  filename: string;
}): Promise<AgentMediaFile | null> {
  const trimmed = params.filename.trim();
  if (!trimmed) {
    console.log("[MEDIA_DEBUG] lookup:", { filename: trimmed, found: false });
    return null;
  }

  const base = params.sb
    .from("agent_media_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "ready");

  const { data: exactMatch, error: exactError } = await base
    .ilike("original_filename", trimmed)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!exactError && exactMatch) {
    console.log("[MEDIA_DEBUG] lookup:", { filename: trimmed, found: true, mode: "exact" });
    return toRow(exactMatch as Record<string, unknown>);
  }

  const partialPattern = `%${escapeIlikePattern(trimmed)}%`;
  const { data: partialMatch, error: partialError } = await base
    .ilike("original_filename", partialPattern)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const found = !partialError && Boolean(partialMatch);
  console.log("[MEDIA_DEBUG] lookup:", { filename: trimmed, found, mode: found ? "partial" : "none" });
  return found ? toRow(partialMatch as Record<string, unknown>) : null;
}

export async function findReadyAgentMediaByOriginalFilename(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  originalFilename: string;
}): Promise<AgentMediaFile | null> {
  const { data, error } = await params.sb
    .from("agent_media_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("original_filename", params.originalFilename)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return toRow(data as Record<string, unknown>);
}

function normalizeFilenameForLooseCompare(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Último segmento sem extensão (minúsculas, sem marcas Unicode). */
function comparableStem(value: string): string {
  const base = normalizeFilenameForLooseCompare(value).replace(/^.*[/\\]/, "").trim();
  const dot = base.lastIndexOf(".");
  const withoutExt = dot > 0 ? base.slice(0, dot) : base;
  return withoutExt.trim();
}

/**
 * Resolve nome vindo do modelo (marcador ENVIAR_MEDIA): igualdade exact na BD primeiro,
 * depois igualdades insensível a caso / acentos, stem sem extensão e substrings curtas seguras.
 */
export async function findReadyAgentMediaByFilenameFlexible(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  candidateName: string;
}): Promise<AgentMediaFile | null> {
  const trimmed = params.candidateName.trim();
  if (!trimmed) return null;

  const direct = await findReadyAgentMediaByOriginalFilename({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    originalFilename: trimmed,
  });
  if (direct) return direct;

  const { data, error } = await params.sb
    .from("agent_media_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(Math.min(AGENT_MEDIA_MAX_FILES + 10, 80));

  if (error || !data?.length) return null;

  const files = ((data ?? []) as Array<Record<string, unknown>>).map(toRow);

  const candNorm = normalizeFilenameForLooseCompare(trimmed);

  let hit = files.find((f) => f.originalFilename.toLowerCase() === trimmed.toLowerCase());
  if (hit) return hit;

  hit = files.find((f) => normalizeFilenameForLooseCompare(f.originalFilename) === candNorm);
  if (hit) return hit;

  const candStem = comparableStem(trimmed);
  if (candStem.length > 0) {
    hit = files.find((f) => comparableStem(f.originalFilename) === candStem);
    if (hit) return hit;
  }

  if (candNorm.length >= 4) {
    hit = files.find((f) => normalizeFilenameForLooseCompare(f.originalFilename).includes(candNorm));
    if (hit) return hit;
  }

  if (candStem.length >= 4) {
    hit = files.find((f) => comparableStem(f.originalFilename).includes(candStem));
  }

  return hit ?? null;
}

async function countActiveAgentMediaSlots(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<number> {
  const { count, error } = await params.sb
    .from("agent_media_files")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .in("status", ["uploading", "ready"]);
  if (error) throw new Error("Erro ao contar arquivos de mídia do agente.");
  return count ?? 0;
}

async function sumReadyAgentMediaBytes(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<number> {
  const { data, error } = await params.sb
    .from("agent_media_files")
    .select("size_bytes")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("status", "ready");
  if (error) throw new Error("Erro ao somar armazenamento de mídia do agente.");
  let sum = 0;
  for (const row of (data ?? []) as Array<{ size_bytes?: unknown }>) {
    sum += Number(row.size_bytes ?? 0);
  }
  return sum;
}

export async function createAgentMediaUpload(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description?: string | null;
}): Promise<{ file: AgentMediaFile; uploadUrl: string; expiresInSeconds: number }> {
  assertR2Configured();
  const trimmedName = params.filename.trim();
  if (!trimmedName) throw new Error("Nome do arquivo em falta.");
  const mimeType = normalizeAgentMediaMimeType(params.mimeType);
  const sizeBytes = Number(params.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Tamanho inválido.");
  }
  if (sizeBytes > AGENT_MEDIA_MAX_SINGLE_FILE_BYTES) {
    throw new Error("Arquivo individual demasiado grande (máx 256MB).");
  }

  const currentSlots = await countActiveAgentMediaSlots(params);
  if (currentSlots >= AGENT_MEDIA_MAX_FILES) throw new Error("Limite de 50 arquivos de envio por agente atingido.");

  const usedBytes = await sumReadyAgentMediaBytes(params);
  if (usedBytes + sizeBytes > AGENT_MEDIA_TOTAL_BYTES_CAP) {
    throw new Error("Limite de 1GB de mídia para envio por agente ultrapassado.");
  }

  const now = new Date().toISOString();
  const storedFilename = `${crypto.randomUUID()}_${safeFilename(trimmedName)}`;
  const storageKey = `agents-media/${params.tenantId}/${cleanAgentId(params.agentId)}/${storedFilename}`;
  const expiresInSeconds = 900;

  const uploadUrl = await createR2PresignedUploadUrl({
    key: storageKey,
    contentType: mimeType,
    contentLength: sizeBytes,
    expiresInSeconds,
  });

  const { data, error } = await params.sb
    .from("agent_media_files")
    .insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      original_filename: trimmedName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      storage_key: storageKey,
      description: params.description?.trim() ? params.description.trim() : null,
      status: "uploading",
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error("Erro ao criar registo de mídia.");
  return { file: toRow(data as Record<string, unknown>), uploadUrl, expiresInSeconds };
}

export async function completeAgentMediaUpload(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<AgentMediaFile> {
  const { data: current, error: currentError } = await params.sb
    .from("agent_media_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .single();

  if (currentError || !current) throw new Error("Arquivo de mídia não encontrado.");
  const row = current as Record<string, unknown>;
  const storageKey = String(row.storage_key ?? "");

  const head = await headR2Object(storageKey);
  if (!head || head.sizeBytes <= 0) {
    await params.sb
      .from("agent_media_files")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("tenant_id", params.tenantId)
      .eq("agent_id", params.agentId)
      .eq("id", params.fileId);
    throw new Error("Arquivo ainda não encontrado no armazenamento.");
  }

  const mimeType = resolveOutboundMimeFromUpload(String(row.mime_type ?? "application/octet-stream"), head.contentType);

  const readyBytesSum = await sumReadyAgentMediaBytes(params);
  if (readyBytesSum + head.sizeBytes > AGENT_MEDIA_TOTAL_BYTES_CAP) {
    await params.sb
      .from("agent_media_files")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("tenant_id", params.tenantId)
      .eq("agent_id", params.agentId)
      .eq("id", params.fileId);
    throw new Error("O tamanho real do arquivo ultrapassa o limite de 1GB por agente.");
  }

  const now = new Date().toISOString();
  const { data, error } = await params.sb
    .from("agent_media_files")
    .update({
      mime_type: mimeType,
      size_bytes: head.sizeBytes,
      status: "ready",
      updated_at: now,
    })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .select("*")
    .single();

  if (error) throw new Error("Erro ao concluir upload de mídia.");
  return toRow(data as Record<string, unknown>);
}

export async function updateAgentMediaDescription(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
  description: string | null;
}): Promise<AgentMediaFile> {
  const desc = params.description?.trim() ? params.description.trim() : null;
  const { data, error } = await params.sb
    .from("agent_media_files")
    .update({
      description: desc,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .select("*")
    .single();
  if (error) throw new Error("Erro ao atualizar descrição.");
  return toRow(data as Record<string, unknown>);
}

export async function removeAgentMediaFile(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<void> {
  const { data, error } = await params.sb
    .from("agent_media_files")
    .select("storage_key")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .single();
  if (error || !data) throw new Error("Arquivo de mídia não encontrado.");

  const storageKey = String((data as { storage_key?: unknown }).storage_key ?? "");

  const { error: deleteError } = await params.sb
    .from("agent_media_files")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId);
  if (deleteError) throw new Error("Erro ao remover arquivo de mídia.");

  if (storageKey) {
    await deleteR2Object(storageKey).catch(() => undefined);
  }
}
