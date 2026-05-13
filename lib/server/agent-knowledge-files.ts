import crypto from "crypto";
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

function cleanAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function filenameExt(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

function safeFilename(filename: string): string {
  const clean = filename.trim().replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, "_");
  return clean.slice(0, 160) || "arquivo";
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

function extractSmallTextCandidate(mimeType: string, storageKey: string): boolean {
  const ext = filenameExt(storageKey);
  return (
    mimeType.startsWith("text/") ||
    ["xml", "md", "markdown", "html", "htm", "csv", "txt"].includes(ext)
  );
}

async function extractSmallTextFromR2(storageKey: string, sizeBytes: number): Promise<string | null> {
  if (sizeBytes > 5 * 1024 * 1024) return null;
  const buffer = await getMediaBufferFromR2(storageKey).catch(() => null);
  if (!buffer) return null;
  return buffer.toString("utf8").replace(/\u0000/g, "").slice(0, 80_000);
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
  const canExtractLater = extractSmallTextCandidate(mimeType, storageKey);
  const extractedText = canExtractLater
    ? await extractSmallTextFromR2(storageKey, head.sizeBytes || Number(row.size_bytes ?? 0))
    : null;
  const { data, error } = await params.sb
    .from("agent_knowledge_files")
    .update({
      status: "ready",
      extracted_text_status: extractedText ? "ready" : canExtractLater ? "pending" : "unsupported",
      extracted_text: extractedText,
      size_bytes: head.sizeBytes || Number(row.size_bytes ?? 0),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .select("*")
    .single();

  if (error) throw new Error("Erro ao concluir upload do material.");
  return toRow(data as Record<string, unknown>);
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
