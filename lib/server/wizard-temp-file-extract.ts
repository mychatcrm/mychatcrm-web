import "server-only";

import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describeImageFromBuffer } from "@/lib/ai/media-processor";
import { filenameExt } from "@/lib/server/agent-knowledge-files";
import { extractKnowledgeText } from "@/lib/server/agent-knowledge-processing";

export const WIZARD_TEMP_MAX_FILES = 10;
export const WIZARD_TEMP_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const WIZARD_TEMP_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const WIZARD_TEMP_MAX_EXTRACTED_CHARS = 80_000;

const LEGACY_OFFICE_EXTENSIONS = new Set(["doc", "xls", "ppt"]);

export const WIZARD_TEMP_ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

export const WIZARD_TEMP_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type WizardTempFileInput = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

export type WizardTempFileExtractResult = {
  filename: string;
  text: string | null;
  warning: string | null;
  error: string | null;
};

function normalizeExtractedText(text: string, maxChars: number): string {
  return text.replace(/\u0000/g, "").trim().slice(0, maxChars);
}

export function validateWizardTempFile(params: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): { filename: string; mimeType: string; sizeBytes: number; ext: string } {
  const filename = params.filename.trim();
  if (!filename) throw new Error("Nome de arquivo inválido.");
  const sizeBytes = params.sizeBytes;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("Tamanho de arquivo inválido.");
  if (sizeBytes > WIZARD_TEMP_MAX_FILE_BYTES) {
    throw new Error(`Arquivo acima do limite de ${Math.round(WIZARD_TEMP_MAX_FILE_BYTES / (1024 * 1024))}MB por arquivo.`);
  }
  const ext = filenameExt(filename);
  const mimeType = params.mimeType.split(";")[0]!.trim().toLowerCase();
  if (!WIZARD_TEMP_ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Extensão não permitida. Use PDF, Office (DOCX/XLSX/PPTX), imagens JPG/PNG/WEBP.");
  }
  if (!WIZARD_TEMP_ALLOWED_MIME.has(mimeType)) {
    throw new Error("Tipo de arquivo não permitido.");
  }
  return { filename, mimeType, sizeBytes, ext };
}

async function extractTextFromXlsx(buffer: Buffer): Promise<string | null> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const trimmed = csv.trim();
    if (trimmed) parts.push(`[Planilha: ${sheetName}]\n${trimmed}`);
  }
  return parts.length ? parts.join("\n\n") : null;
}

async function extractTextFromPptx(buffer: Buffer): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer);
  const slideKeys = Object.keys(zip.files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort();
  const parts: string[] = [];
  for (const key of slideKeys) {
    const file = zip.files[key];
    if (!file) continue;
    const xml = await file.async("string");
    const texts: string[] = [];
    const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      const t = match[1]?.trim();
      if (t) texts.push(t);
    }
    if (texts.length) parts.push(texts.join(" "));
  }
  return parts.length ? parts.join("\n\n") : null;
}

function isImageExt(ext: string, mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "webp"
  );
}

/** Extrai texto de um arquivo temporário do wizard (sem persistir). */
export async function extractWizardTempFile(
  input: WizardTempFileInput,
  remainingCharBudget: number,
): Promise<WizardTempFileExtractResult> {
  const { filename, mimeType, buffer } = input;
  const ext = filenameExt(filename);

  if (LEGACY_OFFICE_EXTENSIONS.has(ext)) {
    return {
      filename,
      text: null,
      warning: `Formato .${ext} legado não suportado para leitura automática. Converta para .${ext}x e envie novamente.`,
      error: null,
    };
  }

  try {
    if (isImageExt(ext, mimeType)) {
      const description = await describeImageFromBuffer(buffer, mimeType);
      if (!description) {
        return {
          filename,
          text: null,
          warning: null,
          error: "Não foi possível analisar a imagem.",
        };
      }
      return {
        filename,
        text: normalizeExtractedText(description, remainingCharBudget),
        warning: null,
        error: null,
      };
    }

    if (ext === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      const text = await extractTextFromXlsx(buffer);
      return {
        filename,
        text: text ? normalizeExtractedText(text, remainingCharBudget) : null,
        warning: text ? null : "Planilha sem texto legível.",
        error: null,
      };
    }

    if (ext === "pptx" || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      const text = await extractTextFromPptx(buffer);
      return {
        filename,
        text: text ? normalizeExtractedText(text, remainingCharBudget) : null,
        warning: text ? null : "Apresentação sem texto legível.",
        error: null,
      };
    }

    const documentText = await extractKnowledgeText({ buffer, mimeType, filename });
    if (documentText) {
      return {
        filename,
        text: normalizeExtractedText(documentText, remainingCharBudget),
        warning: null,
        error: null,
      };
    }

    return {
      filename,
      text: null,
      warning: "Não foi possível extrair texto deste arquivo.",
      error: null,
    };
  } catch (err) {
    return {
      filename,
      text: null,
      warning: null,
      error: err instanceof Error ? err.message : "Erro ao processar arquivo.",
    };
  }
}
