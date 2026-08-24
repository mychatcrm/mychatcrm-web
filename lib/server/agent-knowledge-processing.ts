import "server-only";

import crypto from "crypto";
import JSZip from "jszip";
import { getEncoding } from "js-tiktoken";
import { extractText } from "unpdf";
import * as XLSX from "xlsx";
import { getMediaBufferFromR2 } from "@/lib/integrations/r2-storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const KNOWLEDGE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const KNOWLEDGE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const KNOWLEDGE_TOTAL_MAX_BYTES = 200 * 1024 * 1024;
export const KNOWLEDGE_MAX_EXTRACTED_CHARS = 1_200_000;
export const KNOWLEDGE_CHUNK_TOKENS = 800;
export const KNOWLEDGE_CHUNK_OVERLAP_TOKENS = 120;

const MAX_PDF_PAGES = 800;
const MAX_PPTX_SLIDES = 500;
const MAX_XLSX_SHEETS = 40;
const MAX_XLSX_CELLS = 200_000;
const MAX_OFFICE_ARCHIVE_ENTRIES = 10_000;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
const MAX_OFFICE_SINGLE_ENTRY_BYTES = 25 * 1024 * 1024;
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_BATCH_SIZE = 80;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "tif", "tiff", "bmp"]);
const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "xml", "html", "htm"]);

export type KnowledgeChunk = { content: string; tokenCount: number };

type KnowledgeJobRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  file_id: string;
  processing_version: number;
  claim_token: string;
};

function extOf(value: string): string {
  const clean = value.trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, KNOWLEDGE_MAX_EXTRACTED_CHARS);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function plainTextFromMarkup(value: string): string {
  return cleanText(
    decodeXmlEntities(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function isImage(mimeType: string, ext: string): boolean {
  return mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
}

function hasZipSignature(buffer: Buffer): boolean {
  return buffer.byteLength >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function assertBinarySignature(buffer: Buffer, mimeType: string, ext: string): void {
  if (mimeType === "application/pdf" || ext === "pdf") {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("knowledge_pdf_signature_invalid");
    return;
  }
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") {
    if (!hasZipSignature(buffer)) throw new Error("knowledge_office_signature_invalid");
    return;
  }
  if (ext === "png" && !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("knowledge_image_signature_invalid");
  }
  if ((ext === "jpg" || ext === "jpeg") && !(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
    throw new Error("knowledge_image_signature_invalid");
  }
  if ((ext === "tif" || ext === "tiff") && !(
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  )) throw new Error("knowledge_image_signature_invalid");
  if (ext === "bmp" && !(buffer[0] === 0x42 && buffer[1] === 0x4d)) {
    throw new Error("knowledge_image_signature_invalid");
  }
}

async function assertOfficeArchiveLimits(buffer: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const entries = Object.values(zip.files);
  if (entries.length > MAX_OFFICE_ARCHIVE_ENTRIES) throw new Error("knowledge_office_entry_limit");
  let total = 0;
  for (const entry of entries) {
    const compressed = entry as typeof entry & { _data?: { uncompressedSize?: number } };
    const size = Math.max(0, Number(compressed._data?.uncompressedSize ?? 0));
    if (size > MAX_OFFICE_SINGLE_ENTRY_BYTES) throw new Error("knowledge_office_entry_size_limit");
    total += size;
    if (total > MAX_OFFICE_UNCOMPRESSED_BYTES) throw new Error("knowledge_office_uncompressed_limit");
  }
  return zip;
}

export function assertKnowledgeFileSize(params: { mimeType: string; filename: string; sizeBytes: number }): void {
  const ext = extOf(params.filename);
  const image = isImage(params.mimeType, ext);
  const limit = image ? KNOWLEDGE_IMAGE_MAX_BYTES : KNOWLEDGE_DOCUMENT_MAX_BYTES;
  if (!Number.isFinite(params.sizeBytes) || params.sizeBytes <= 0 || params.sizeBytes > limit) {
    throw new Error(image ? "knowledge_image_too_large" : "knowledge_document_too_large");
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const result = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  if (pages.length > MAX_PDF_PAGES) throw new Error("knowledge_pdf_page_limit");
  return cleanText(pages.map((page, index) => `[page ${index + 1}]\n${String(page)}`).join("\n\n"));
}

async function extractDocx(buffer: Buffer): Promise<string> {
  await assertOfficeArchiveLimits(buffer);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return cleanText(result.value ?? "");
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  await assertOfficeArchiveLimits(buffer);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  if (workbook.SheetNames.length > MAX_XLSX_SHEETS) throw new Error("knowledge_xlsx_sheet_limit");
  const lines: string[] = [];
  let cells = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    if (sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const addressableCells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (!Number.isSafeInteger(addressableCells) || cells + addressableCells > MAX_XLSX_CELLS) {
        throw new Error("knowledge_xlsx_cell_limit");
      }
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false });
    lines.push(`[sheet ${sheetName}]`);
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const values = row.slice(0, 250).map((cell) => String(cell ?? "").trim());
      cells += values.filter(Boolean).length;
      if (cells > MAX_XLSX_CELLS) throw new Error("knowledge_xlsx_cell_limit");
      if (values.some(Boolean)) lines.push(values.join("\t"));
    }
  }
  return cleanText(lines.join("\n"));
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await assertOfficeArchiveLimits(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] ?? 0) - Number(b.match(/slide(\d+)/i)?.[1] ?? 0));
  if (slides.length > MAX_PPTX_SLIDES) throw new Error("knowledge_pptx_slide_limit");
  const output: string[] = [];
  for (let index = 0; index < slides.length; index += 1) {
    const xml = await zip.files[slides[index]!]!.async("string");
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)]
      .map((match) => decodeXmlEntities(match[1] ?? "").trim())
      .filter(Boolean)
      .join("\n");
    if (text) output.push(`[slide ${index + 1}]\n${text}`);
  }
  return cleanText(output.join("\n\n"));
}

function mapOcrLanguage(raw: unknown): string[] {
  const language = typeof raw === "string" ? raw.toLowerCase() : "";
  const map: Array<[RegExp, string]> = [
    [/portugu|(^|[-_])pt($|[-_])/, "por"],
    [/espa|spanish|(^|[-_])es($|[-_])/, "spa"],
    [/arab|(^|[-_])ar($|[-_])/, "ara"],
    [/japan|japon|(^|[-_])ja($|[-_])/, "jpn"],
    [/chinese|chin[eê]s|(^|[-_])zh($|[-_])/, "chi_sim"],
    [/hindi|(^|[-_])hi($|[-_])/, "hin"],
    [/russian|russo|(^|[-_])ru($|[-_])/, "rus"],
    [/french|fran[cç]|(^|[-_])fr($|[-_])/, "fra"],
    [/german|alem[aã]|(^|[-_])de($|[-_])/, "deu"],
    [/italian|italiano|(^|[-_])it($|[-_])/, "ita"],
  ];
  const matched = map.find(([pattern]) => pattern.test(language));
  if (matched) return [matched[1], "eng"];
  return ["eng", "por", "spa"];
}

async function extractImageText(buffer: Buffer, languages: string[]): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(languages);
  try {
    const result = await worker.recognize(buffer);
    return cleanText(result.data.text ?? "");
  } finally {
    await worker.terminate();
  }
}

export async function extractKnowledgeText(params: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  ocrLanguages?: string[];
}): Promise<string> {
  assertKnowledgeFileSize({ mimeType: params.mimeType, filename: params.filename, sizeBytes: params.buffer.byteLength });
  const ext = extOf(params.filename);
  assertBinarySignature(params.buffer, params.mimeType, ext);
  let extracted = "";
  if (params.mimeType === "application/pdf" || ext === "pdf") extracted = await extractPdf(params.buffer);
  else if (ext === "docx") extracted = await extractDocx(params.buffer);
  else if (ext === "xlsx") extracted = await extractXlsx(params.buffer);
  else if (ext === "pptx") extracted = await extractPptx(params.buffer);
  else if (isImage(params.mimeType, ext)) extracted = await extractImageText(params.buffer, params.ocrLanguages ?? ["eng", "por", "spa"]);
  else if (PLAIN_TEXT_EXTENSIONS.has(ext) || params.mimeType.startsWith("text/")) {
    const raw = params.buffer.toString("utf8");
    const replacementCount = (raw.match(/\ufffd/g) ?? []).length;
    if (raw.includes("\u0000") || replacementCount > Math.max(4, raw.length * 0.02)) {
      throw new Error("knowledge_text_encoding_invalid");
    }
    extracted = ext === "html" || ext === "htm" || ext === "xml" ? plainTextFromMarkup(raw) : cleanText(raw);
  }
  if (!extracted) throw new Error("knowledge_no_extractable_text");
  return extracted;
}

export function chunkKnowledgeText(text: string): KnowledgeChunk[] {
  const encoding = getEncoding("cl100k_base");
  try {
    const tokens = encoding.encode(cleanText(text));
    if (tokens.length === 0) return [];
    const chunks: KnowledgeChunk[] = [];
    const step = KNOWLEDGE_CHUNK_TOKENS - KNOWLEDGE_CHUNK_OVERLAP_TOKENS;
    for (let start = 0; start < tokens.length && chunks.length < 4000; start += step) {
      const slice = tokens.slice(start, Math.min(tokens.length, start + KNOWLEDGE_CHUNK_TOKENS));
      const content = cleanText(encoding.decode(slice));
      if (content) chunks.push({ content, tokenCount: slice.length });
      if (start + KNOWLEDGE_CHUNK_TOKENS >= tokens.length) break;
    }
    return chunks;
  } finally {
    // js-tiktoken 1.x não expõe lifecycle explícito para este encoder.
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Vetor local e determinístico por feature hashing. O material nunca sai da
 * infraestrutura do MyChatCRM; palavras e n-gramas Unicode mantêm a busca
 * independente de idioma e evitam depender de um nicho ou vocabulário fixo.
 */
export function createLocalKnowledgeEmbedding(input: string): number[] {
  const normalized = cleanText(input).normalize("NFKC").toLocaleLowerCase();
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const features: string[] = [];
  for (const word of words) {
    features.push(`w:${word}`);
    const chars = [...word];
    if (chars.length < 3) features.push(`c:${word}`);
    for (let index = 0; index <= chars.length - 3; index += 1) {
      features.push(`c:${chars.slice(index, index + 3).join("")}`);
    }
  }
  for (const feature of features) {
    const hash = fnv1a(feature);
    const bucket = hash % EMBEDDING_DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + ((hash & 0x80000000) === 0 ? 1 : -1);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "processing_failed");
  return raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "processing_failed";
}

async function heartbeat(sb: SupabaseServiceClient, job: KnowledgeJobRow): Promise<void> {
  const { data, error } = await sb.rpc("heartbeat_agent_knowledge_job_v1", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_extend_seconds: 240,
  });
  if (error || data !== true) throw new Error("knowledge_claim_lost");
}

async function finishJob(params: {
  sb: SupabaseServiceClient;
  job: KnowledgeJobRow;
  success: boolean;
  chunkCount?: number;
  contentSha256?: string | null;
  errorCode?: string | null;
}): Promise<boolean> {
  const { data, error } = await params.sb.rpc("finish_agent_knowledge_job_v1", {
    p_job_id: params.job.id,
    p_claim_token: params.job.claim_token,
    p_success: params.success,
    p_chunk_count: params.chunkCount ?? 0,
    p_content_sha256: params.contentSha256 ?? null,
    p_error_code: params.errorCode ?? null,
  });
  if (error) throw new Error(`knowledge_finish_failed:${error.message}`);
  return data === true;
}

async function processKnowledgeJob(sb: SupabaseServiceClient, job: KnowledgeJobRow): Promise<"completed" | "failed" | "claim_lost"> {
  let heartbeatFailure: unknown = null;
  let heartbeatRunning = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatRunning || heartbeatFailure) return;
    heartbeatRunning = true;
    void heartbeat(sb, job)
      .catch((error) => {
        heartbeatFailure = error;
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, 45_000);
  const assertClaim = async (): Promise<void> => {
    if (heartbeatFailure) throw new Error("knowledge_claim_lost");
    await heartbeat(sb, job);
    if (heartbeatFailure) throw new Error("knowledge_claim_lost");
  };
  try {
    const [{ data: file, error }, { data: agent }] = await Promise.all([
      sb
        .from("agent_knowledge_files")
        .select("id,tenant_id,agent_id,original_filename,stored_filename,mime_type,size_bytes,storage_key,processing_version")
        .eq("id", job.file_id)
        .eq("tenant_id", job.tenant_id)
        .eq("agent_id", job.agent_id)
        .maybeSingle(),
      sb
        .from("tenant_agents")
        .select("metadata,archived_at")
        .eq("tenant_id", job.tenant_id)
        .eq("agent_id", job.agent_id)
        .maybeSingle(),
    ]);
    if (error || !file) throw new Error("knowledge_file_not_found");
    if (!agent || agent.archived_at) throw new Error("knowledge_agent_unavailable");
    if (Number(file.processing_version) !== Number(job.processing_version)) throw new Error("knowledge_version_stale");
    const filename = String(file.original_filename ?? file.stored_filename ?? "");
    const mimeType = String(file.mime_type ?? "application/octet-stream");
    assertKnowledgeFileSize({ filename, mimeType, sizeBytes: Number(file.size_bytes ?? 0) });
    await assertClaim();
    const buffer = await getMediaBufferFromR2(String(file.storage_key ?? ""));
    assertKnowledgeFileSize({ filename, mimeType, sizeBytes: buffer.byteLength });
    const metadata = agent?.metadata && typeof agent.metadata === "object" ? (agent.metadata as Record<string, unknown>) : {};
    const extractedText = await extractKnowledgeText({
      buffer,
      mimeType,
      filename,
      ocrLanguages: mapOcrLanguage(metadata.idioma ?? metadata.language),
    });
    const chunks = chunkKnowledgeText(extractedText);
    if (chunks.length === 0) throw new Error("knowledge_no_chunks");
    await assertClaim();
    for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
      await assertClaim();
      const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
      const rows = batch.map((chunk, batchIndex) => ({
        chunk_index: index + batchIndex,
        content: chunk.content,
        token_count: chunk.tokenCount,
        source_label: filename.slice(0, 300),
        embedding: createLocalKnowledgeEmbedding(chunk.content),
      }));
      const { data: inserted, error: insertError } = await sb.rpc("insert_agent_knowledge_chunks_v1", {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_chunks: rows,
      });
      if (insertError) throw new Error(`knowledge_chunk_insert_failed_${insertError.code ?? "database"}`);
      if (inserted !== true) throw new Error("knowledge_claim_lost");
    }
    const contentSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    return (await finishJob({
      sb,
      job,
      success: true,
      chunkCount: chunks.length,
      contentSha256,
    })) ? "completed" : "claim_lost";
  } catch (error) {
    const code = safeErrorCode(error);
    if (code === "knowledge_claim_lost") return "claim_lost";
    const finished = await finishJob({ sb, job, success: false, errorCode: code }).catch(() => false);
    console.warn("[agent-knowledge] processing_failed", {
      tenant_id: job.tenant_id,
      agent_id: job.agent_id,
      file_id: job.file_id,
      job_id: job.id,
      error_code: code,
    });
    return finished ? "failed" : "claim_lost";
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function processAgentKnowledgeJobs(params: { sb?: SupabaseServiceClient; limit?: number } = {}): Promise<{
  claimed: number;
  completed: number;
  failed: number;
  claimLost: number;
}> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb.rpc("claim_agent_knowledge_jobs_v1", {
    p_limit: Math.max(1, Math.min(params.limit ?? 2, 2)),
    p_claim_seconds: 240,
  });
  if (error) throw new Error(`knowledge_claim_failed:${error.message}`);
  const jobs = (Array.isArray(data) ? data : []) as KnowledgeJobRow[];
  const result = { claimed: jobs.length, completed: 0, failed: 0, claimLost: 0 };
  // Every claimed job must start immediately so its lease receives heartbeats.
  // Claiming a batch and processing it sequentially lets later OCR jobs expire
  // before they even start when the first document is large.
  const outcomes = await Promise.all(jobs.map((job) => processKnowledgeJob(sb, job)));
  for (const outcome of outcomes) {
    if (outcome === "completed") result.completed += 1;
    else if (outcome === "failed") result.failed += 1;
    else result.claimLost += 1;
  }
  return result;
}

export function embedKnowledgeQuery(query: string): number[] | null {
  const normalized = cleanText(query).slice(0, 12_000);
  return normalized ? createLocalKnowledgeEmbedding(normalized) : null;
}
