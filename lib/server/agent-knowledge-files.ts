import "server-only";

import crypto from "crypto";
import { extractText } from "unpdf";
import {
  assertR2Configured,
  createR2PresignedUploadUrl,
  deleteR2Object,
  getMediaBufferFromR2,
  getR2BucketName,
  headR2Object,
} from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const AGENT_KNOWLEDGE_MAX_FILES = 50;
export const AGENT_KNOWLEDGE_MAX_BYTES = 1024 * 1024 * 1024;
export const AGENT_KNOWLEDGE_MAX_EXTRACTED_CHARS = 80_000;
const PLAIN_TEXT_MAX_BYTES = 5 * 1024 * 1024;

export const AGENT_KNOWLEDGE_ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "xml",
  "md",
  "markdown",
  "html",
  "htm",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "bmp",
  "txt",
]);

export const AGENT_KNOWLEDGE_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/xml",
  "text/xml",
  "text/markdown",
  "text/html",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/bmp",
]);

const PLAIN_TEXT_EXTENSIONS = new Set(["xml", "md", "markdown", "html", "htm", "csv", "txt"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentKnowledgeFile = {
  id: string;
  tenantId: string;
  agentId: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageBucket: string;
  storageKey: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  extractedTextStatus: "pending" | "processing" | "ready" | "failed" | "unsupported";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeExtractionResult = {
  extractedText: string | null;
  extractedTextStatus: AgentKnowledgeFile["extractedTextStatus"];
  errorMessage: string | null;
};

function cleanAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

export function filenameExt(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

function safeFilename(filename: string): string {
  const clean = filename.trim().replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, "_");
  return clean.slice(0, 160) || "arquivo";
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, "").trim().slice(0, AGENT_KNOWLEDGE_MAX_EXTRACTED_CHARS);
}

function toRow(row: Record<string, unknown>): AgentKnowledgeFile {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    agentId: String(row.agent_id),
    originalFilename: String(row.original_filename ?? ""),
    storedFilename: String(row.stored_filename ?? ""),
    mimeType: String(row.mime_type ?? "application/octet-stream"),
    sizeBytes: Number(row.size_bytes ?? 0),
    storageBucket: String(row.storage_bucket ?? getR2BucketName()),
    storageKey: String(row.storage_key ?? ""),
    status: String(row.status ?? "uploaded") as AgentKnowledgeFile["status"],
    extractedTextStatus: String(row.extracted_text_status ?? "pending") as AgentKnowledgeFile["extractedTextStatus"],
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function validateKnowledgeFileInput(params: {
  filename: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
}): { filename: string; mimeType: string; sizeBytes: number; ext: string } {
  if (typeof params.filename !== "string" || !params.filename.trim()) throw new Error("Nome de arquivo inválido.");
  if (typeof params.mimeType !== "string" || !params.mimeType.trim()) throw new Error("Tipo de arquivo inválido.");
  const sizeBytes = Number(params.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("Tamanho de arquivo inválido.");
  if (sizeBytes > AGENT_KNOWLEDGE_MAX_BYTES) throw new Error("Arquivo acima do limite de 1GB.");
  const ext = filenameExt(params.filename);
  const mimeType = params.mimeType.split(";")[0]!.trim().toLowerCase();
  if (!AGENT_KNOWLEDGE_ALLOWED_EXTENSIONS.has(ext)) throw new Error("Extensão de arquivo não permitida.");
  if (!AGENT_KNOWLEDGE_ALLOWED_MIME.has(mimeType)) throw new Error("Tipo de arquivo não permitido.");
  return { filename: params.filename.trim(), mimeType, sizeBytes, ext };
}

function isPlainTextCandidate(mimeType: string, ext: string): boolean {
  return mimeType.startsWith("text/") || PLAIN_TEXT_EXTENSIONS.has(ext);
}

function isDocumentCandidate(mimeType: string, ext: string): boolean {
  return (
    DOCUMENT_EXTENSIONS.has(ext) ||
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

/** Indica formatos para os quais há pipeline de extração (texto plano, PDF ou DOCX). */
export function extractSmallTextCandidate(mimeType: string, storageKey: string): boolean {
  const ext = filenameExt(storageKey);
  return isPlainTextCandidate(mimeType, ext) || isDocumentCandidate(mimeType, ext);
}

/** Extrai texto de PDF/DOCX; outros binários retornam null. */
export async function extractTextFromDocument(
  buffer: Buffer,
  mimeType: string,
  ext: string,
): Promise<string | null> {
  const normalizedMime = mimeType.split(";")[0]!.trim().toLowerCase();
  const normalizedExt = ext.toLowerCase();

  try {
    if (normalizedMime === "application/pdf" || normalizedExt === "pdf") {
      const uint8 = new Uint8Array(buffer);
      const { text } = await extractText(uint8, { mergePages: true });
      const normalized = normalizeExtractedText(text ?? "");
      return normalized || null;
    }

    if (
      normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      normalizedExt === "docx"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const normalized = normalizeExtractedText(result.value ?? "");
      return normalized || null;
    }
  } catch (err) {
    console.error("[agent-knowledge-files] extractTextFromDocument error", {
      mimeType: normalizedMime,
      ext: normalizedExt,
      sizeBytes: buffer.byteLength,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return null;
  }

  return null;
}

async function extractPlainTextFromBuffer(buffer: Buffer): Promise<string | null> {
  const normalized = normalizeExtractedText(buffer.toString("utf8"));
  return normalized || null;
}

async function extractKnowledgeFromStorage(
  storageKey: string,
  mimeType: string,
  sizeBytes: number,
): Promise<KnowledgeExtractionResult> {
  const ext = filenameExt(storageKey);
  const buffer = await getMediaBufferFromR2(storageKey).catch(() => null);
  if (!buffer) {
    return {
      extractedText: null,
      extractedTextStatus: "failed",
      errorMessage: "Não foi possível ler o arquivo no storage.",
    };
  }

  if (isDocumentCandidate(mimeType, ext)) {
    const extractedText = await extractTextFromDocument(buffer, mimeType, ext);
    if (extractedText) {
      return { extractedText, extractedTextStatus: "ready", errorMessage: null };
    }
    return {
      extractedText: null,
      extractedTextStatus: "failed",
      errorMessage: "Falha ao extrair texto do documento.",
    };
  }

  if (isPlainTextCandidate(mimeType, ext)) {
    if (sizeBytes > PLAIN_TEXT_MAX_BYTES) {
      return { extractedText: null, extractedTextStatus: "pending", errorMessage: null };
    }
    const extractedText = await extractPlainTextFromBuffer(buffer);
    if (extractedText) {
      return { extractedText, extractedTextStatus: "ready", errorMessage: null };
    }
    return {
      extractedText: null,
      extractedTextStatus: "failed",
      errorMessage: "Arquivo de texto vazio ou ilegível.",
    };
  }

  return { extractedText: null, extractedTextStatus: "unsupported", errorMessage: null };
}

async function applyKnowledgeExtractionToRow(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<AgentKnowledgeFile> {
  const extraction = await extractKnowledgeFromStorage(params.storageKey, params.mimeType, params.sizeBytes);

  const { data, error } = await params.sb
    .from("agent_knowledge_files")
    .update({
      status: "ready",
      extracted_text_status: extraction.extractedTextStatus,
      extracted_text: extraction.extractedText,
      error_message: extraction.errorMessage,
      size_bytes: params.sizeBytes,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .select("*")
    .single();

  if (error) throw new Error("Erro ao atualizar material.");
  return toRow(data as Record<string, unknown>);
}

export async function countAgentKnowledgeFiles(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<number> {
  const { count, error } = await params.sb
    .from("agent_knowledge_files")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId);
  if (error) throw new Error("Erro ao contar materiais do agente.");
  return count ?? 0;
}

export async function createAgentKnowledgeUpload(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ file: AgentKnowledgeFile; uploadUrl: string; expiresInSeconds: number }> {
  assertR2Configured();
  const valid = validateKnowledgeFileInput(params);
  const currentCount = await countAgentKnowledgeFiles(params);
  if (currentCount >= AGENT_KNOWLEDGE_MAX_FILES) throw new Error("Limite de 50 materiais por agente atingido.");

  const now = new Date().toISOString();
  const storedFilename = `${crypto.randomUUID()}_${safeFilename(valid.filename)}`;
  const storageKey = `agents/${params.tenantId}/${cleanAgentId(params.agentId)}/${storedFilename}`;
  const expiresInSeconds = 900;
  const uploadUrl = await createR2PresignedUploadUrl({
    key: storageKey,
    contentType: valid.mimeType,
    contentLength: valid.sizeBytes,
    expiresInSeconds,
  });

  const { data, error } = await params.sb
    .from("agent_knowledge_files")
    .insert({
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      original_filename: valid.filename,
      stored_filename: storedFilename,
      mime_type: valid.mimeType,
      size_bytes: valid.sizeBytes,
      storage_bucket: getR2BucketName(),
      storage_key: storageKey,
      status: "uploaded",
      extracted_text_status: "pending",
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error("Erro ao criar metadados do material.");
  return { file: toRow(data as Record<string, unknown>), uploadUrl, expiresInSeconds };
}

export async function completeAgentKnowledgeUpload(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<AgentKnowledgeFile> {
  const { data: current, error: currentError } = await params.sb
    .from("agent_knowledge_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .single();
  if (currentError || !current) throw new Error("Material não encontrado.");

  const row = current as Record<string, unknown>;
  const storageKey = String(row.storage_key ?? "");
  const head = await headR2Object(storageKey);
  if (!head) {
    throw new Error("Arquivo ainda não encontrado no R2.");
  }

  const mimeType = String(row.mime_type ?? head.contentType ?? "application/octet-stream");
  const sizeBytes = head.sizeBytes || Number(row.size_bytes ?? 0);

  return applyKnowledgeExtractionToRow({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    fileId: params.fileId,
    storageKey,
    mimeType,
    sizeBytes,
  });
}

export async function reprocessAgentKnowledgeFile(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<AgentKnowledgeFile> {
  const { data: current, error: currentError } = await params.sb
    .from("agent_knowledge_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .single();
  if (currentError || !current) throw new Error("Material não encontrado.");

  const row = current as Record<string, unknown>;
  const storageKey = String(row.storage_key ?? "");
  const head = await headR2Object(storageKey);
  if (!head) {
    throw new Error("Arquivo não encontrado no R2.");
  }

  const mimeType = String(row.mime_type ?? head.contentType ?? "application/octet-stream");
  const sizeBytes = head.sizeBytes || Number(row.size_bytes ?? 0);

  await params.sb
    .from("agent_knowledge_files")
    .update({
      status: "processing",
      extracted_text_status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId);

  return applyKnowledgeExtractionToRow({
    sb: params.sb,
    tenantId: params.tenantId,
    agentId: params.agentId,
    fileId: params.fileId,
    storageKey,
    mimeType,
    sizeBytes,
  });
}

export async function listAgentKnowledgeFiles(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
}): Promise<AgentKnowledgeFile[]> {
  const { data, error } = await params.sb
    .from("agent_knowledge_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Erro ao listar materiais do agente.");
  return ((data ?? []) as Array<Record<string, unknown>>).map(toRow);
}

export async function removeAgentKnowledgeFile(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<void> {
  const { data, error } = await params.sb
    .from("agent_knowledge_files")
    .select("storage_key")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .single();
  if (error || !data) throw new Error("Material não encontrado.");
  const storageKey = String((data as { storage_key?: unknown }).storage_key ?? "");

  const { error: deleteError } = await params.sb
    .from("agent_knowledge_files")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId);
  if (deleteError) throw new Error("Erro ao remover material.");
  if (storageKey) await deleteR2Object(storageKey).catch(() => undefined);
}
