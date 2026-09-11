import { LAB_MAX_UPLOAD_BYTES, type LabMediaKind } from "./contracts";
const TYPES: Record<string, { mime: string; kind: LabMediaKind }> = {
  png: { mime: "image/png", kind: "image" }, jpg: { mime: "image/jpeg", kind: "image" }, jpeg: { mime: "image/jpeg", kind: "image" },
  webp: { mime: "image/webp", kind: "image" }, mp4: { mime: "video/mp4", kind: "video" },
  ogg: { mime: "audio/ogg", kind: "audio" }, mp3: { mime: "audio/mpeg", kind: "audio" },
  wav: { mime: "audio/wav", kind: "audio" }, m4a: { mime: "audio/mp4", kind: "audio" }, webm: { mime: "audio/webm", kind: "audio" },
  pdf: { mime: "application/pdf", kind: "document" }, txt: { mime: "text/plain", kind: "document" }, csv: { mime: "text/csv", kind: "document" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document" },
};
export function parseLabAssetMetadata(value: unknown) {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== "object" || typeof input.filename !== "string" || input.filename.length > 200 || /[\\/\x00-\x1f]/.test(input.filename)) throw new Error("invalid_filename");
  const extension = input.filename.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[extension];
  if (!type) throw new Error("unsupported_file_type");
  const size = Number(input.byteSize);
  if (!Number.isInteger(size) || size < 1 || size > LAB_MAX_UPLOAD_BYTES) throw new Error("file_too_large");
  if (!Array.isArray(input.expectedFacts) || input.expectedFacts.length > 20 || input.expectedFacts.some(f => typeof f !== "string" || f.length > 500)) throw new Error("invalid_facts");
  return { filename: input.filename, extension, byteSize: size, mimeType: type.mime, kind: type.kind, expectedFacts: input.expectedFacts as string[] };
}
/** These checks reject disguised executables/HTML. Parsing remains isolated and bounded. */
export function validateLabFileSignature(bytes: Uint8Array, extension: string): boolean {
  const head = (count: number) => Array.from(bytes.slice(0, count)).map(v => String.fromCharCode(v)).join("");
  if (["txt", "csv"].includes(extension)) {
    try { const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return !text.includes("\0") && !/^\s*<(?:!doctype|html|script|svg)/i.test(text); } catch { return false; }
  }
  if (extension === "pdf") return head(5) === "%PDF-";
  if (["docx", "xlsx", "pptx"].includes(extension)) return head(4) === "PK\x03\x04";
  if (extension === "png") return head(8) === "\x89PNG\r\n\x1a\n";
  if (["jpg", "jpeg"].includes(extension)) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "ogg") return head(4) === "OggS";
  if (extension === "mp3") return head(3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (extension === "webm") return head(4) === "\x1aE\xdf\xa3";
  if (extension === "wav" || extension === "webp") return head(4) === "RIFF" && head(12).slice(8) === (extension === "wav" ? "WAVE" : "WEBP");
  if (["mp4", "m4a"].includes(extension)) return head(8).slice(4) === "ftyp";
  return false;
}
