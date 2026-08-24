import "server-only";

import crypto from "crypto";
import {
  assertR2Configured,
  createR2PresignedUploadUrl,
  deleteR2Object,
  getR2BucketName,
  headR2Object,
} from "@/lib/integrations/r2-storage";
import {
  KNOWLEDGE_DOCUMENT_MAX_BYTES,
  KNOWLEDGE_IMAGE_MAX_BYTES,
  KNOWLEDGE_TOTAL_MAX_BYTES,
  assertKnowledgeFileSize,
} from "@/lib/server/agent-knowledge-processing";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const AGENT_KNOWLEDGE_MAX_FILES = 5;
export const AGENT_KNOWLEDGE_MAX_BYTES = KNOWLEDGE_DOCUMENT_MAX_BYTES;
export const AGENT_KNOWLEDGE_IMAGE_MAX_BYTES = KNOWLEDGE_IMAGE_MAX_BYTES;
export const AGENT_KNOWLEDGE_TOTAL_MAX_BYTES = KNOWLEDGE_TOTAL_MAX_BYTES;

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

const MIME_BY_EXTENSION: Record<string, ReadonlySet<string>> = {
  pdf: new Set(["application/pdf"]),
  docx: new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  pptx: new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]),
  xml: new Set(["application/xml", "text/xml"]),
  md: new Set(["text/markdown", "text/plain"]),
  markdown: new Set(["text/markdown", "text/plain"]),
  html: new Set(["text/html"]),
  htm: new Set(["text/html"]),
  csv: new Set(["text/csv", "text/plain"]),
  txt: new Set(["text/plain"]),
  png: new Set(["image/png"]),
  jpg: new Set(["image/jpeg"]),
  jpeg: new Set(["image/jpeg"]),
  tif: new Set(["image/tiff"]),
  tiff: new Set(["image/tiff"]),
  bmp: new Set(["image/bmp"]),
};

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
  chunkCount: number;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

function toRow(row: Record<string, unknown>): AgentKnowledgeFile {
  const rawError = typeof row.error_message === "string" ? row.error_message : null;
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
    errorMessage: rawError && /^[a-z0-9_]{1,96}$/.test(rawError) ? rawError : rawError ? "processing_failed" : null,
    chunkCount: Number(row.chunk_count ?? 0),
    processedAt: typeof row.processed_at === "string" ? row.processed_at : null,
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
  const ext = filenameExt(params.filename);
  const mimeType = params.mimeType.split(";")[0]!.trim().toLowerCase();
  if (!AGENT_KNOWLEDGE_ALLOWED_EXTENSIONS.has(ext)) throw new Error("Extensão de arquivo não permitida.");
  if (!AGENT_KNOWLEDGE_ALLOWED_MIME.has(mimeType)) throw new Error("Tipo de arquivo não permitido.");
  if (!MIME_BY_EXTENSION[ext]?.has(mimeType)) {
    throw new Error("A extensão e o tipo do arquivo não correspondem.");
  }
  try {
    assertKnowledgeFileSize({ filename: params.filename, mimeType, sizeBytes });
  } catch (error) {
    const code = error instanceof Error ? error.message : "knowledge_document_too_large";
    throw new Error(
      code === "knowledge_image_too_large"
        ? "Imagem acima do limite de 20 MB."
        : "Documento acima do limite de 50 MB.",
    );
  }
  return { filename: params.filename.trim(), mimeType, sizeBytes, ext };
}

async function enqueueAgentKnowledgeProcessing(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<AgentKnowledgeFile> {
  const { error: enqueueError } = await params.sb.rpc("enqueue_agent_knowledge_job_v1", {
    p_tenant_id: params.tenantId,
    p_agent_id: params.agentId,
    p_file_id: params.fileId,
  });
  if (enqueueError) throw new Error(`Não foi possível enfileirar o processamento: ${enqueueError.message}`);
  const { data, error } = await params.sb
    .from("agent_knowledge_files")
    .select("*")
    .eq("tenant_id", params.tenantId)
    .eq("agent_id", params.agentId)
    .eq("id", params.fileId)
    .single();
  if (error || !data) throw new Error("Material não encontrado após o enfileiramento.");
  return toRow(data as Record<string, unknown>);
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
  const fileId = crypto.randomUUID();
  const storedFilename = `${crypto.randomUUID()}_${safeFilename(valid.filename)}`;
  const storageKey = `agents/${params.tenantId}/${cleanAgentId(params.agentId)}/${storedFilename}`;
  const expiresInSeconds = 900;
  const uploadUrl = await createR2PresignedUploadUrl({
    key: storageKey,
    contentType: valid.mimeType,
    contentLength: valid.sizeBytes,
    expiresInSeconds,
  });

  const { data, error } = await params.sb.rpc("reserve_agent_knowledge_file_v1", {
    p_file_id: fileId,
    p_tenant_id: params.tenantId,
    p_agent_id: params.agentId,
    p_original_filename: valid.filename,
    p_stored_filename: storedFilename,
    p_mime_type: valid.mimeType,
    p_size_bytes: valid.sizeBytes,
    p_storage_bucket: getR2BucketName(),
    p_storage_key: storageKey,
  });
  if (error) {
    const code = error.message ?? "";
    if (code.includes("knowledge_file_limit")) throw new Error("Limite de 5 materiais por agente atingido.");
    if (code.includes("knowledge_total_size_limit")) {
      throw new Error("Os materiais deste agente ultrapassariam o limite total de 200 MB.");
    }
    throw new Error("Erro ao reservar os metadados do material.");
  }
  const reserved = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!reserved) throw new Error("Erro ao reservar os metadados do material.");
  return { file: toRow(reserved), uploadUrl, expiresInSeconds };
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

  const mimeType = String(row.mime_type ?? "application/octet-stream");
  const uploadedMimeType = head.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (uploadedMimeType && uploadedMimeType !== mimeType) {
    throw new Error("O tipo enviado não corresponde ao tipo reservado. Inicie o upload novamente.");
  }
  const sizeBytes = Number(head.sizeBytes);
  validateKnowledgeFileInput({ filename: String(row.original_filename ?? storageKey), mimeType, sizeBytes });
  if (sizeBytes !== Number(row.size_bytes ?? 0)) {
    throw new Error("O tamanho enviado não corresponde ao tamanho reservado. Inicie o upload novamente.");
  }
  return enqueueAgentKnowledgeProcessing(params);
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

  const mimeType = String(row.mime_type ?? "application/octet-stream");
  const uploadedMimeType = head.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (uploadedMimeType && uploadedMimeType !== mimeType) {
    throw new Error("O tipo armazenado não corresponde ao material cadastrado.");
  }
  const sizeBytes = Number(head.sizeBytes);
  validateKnowledgeFileInput({ filename: String(row.original_filename ?? storageKey), mimeType, sizeBytes });
  if (sizeBytes !== Number(row.size_bytes ?? 0)) {
    throw new Error("O tamanho armazenado não corresponde ao material cadastrado.");
  }
  return enqueueAgentKnowledgeProcessing(params);
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
  const { data, error } = await params.sb.rpc("delete_agent_knowledge_file_v1", {
    p_tenant_id: params.tenantId,
    p_agent_id: params.agentId,
    p_file_id: params.fileId,
  });
  if (error) {
    if ((error.message ?? "").includes("knowledge_file_not_found")) throw new Error("Material não encontrado.");
    throw new Error("Erro ao remover material.");
  }
  const storageKey = typeof data === "string" ? data : "";
  if (storageKey) await deleteR2Object(storageKey).catch(() => undefined);
}
