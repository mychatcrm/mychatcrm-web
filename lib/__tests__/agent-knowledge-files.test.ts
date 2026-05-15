import { describe, expect, it, vi } from "vitest";
import {
  AGENT_KNOWLEDGE_MAX_BYTES,
  extractTextFromDocument,
  validateKnowledgeFileInput,
} from "@/lib/server/agent-knowledge-files";

vi.mock("pdf-parse", () => ({
  default: vi.fn(async () => ({ text: "  Conteúdo PDF  \n\n" })),
}));

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(async () => ({ value: "  Texto DOCX  " })),
}));

describe("agent knowledge file validation", () => {
  it("accepts supported files under the 1GB limit", () => {
    expect(
      validateKnowledgeFileInput({
        filename: "catalogo.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).toMatchObject({ filename: "catalogo.pdf", mimeType: "application/pdf", ext: "pdf" });
  });

  it("blocks files above 1GB", () => {
    expect(() =>
      validateKnowledgeFileInput({
        filename: "grande.pdf",
        mimeType: "application/pdf",
        sizeBytes: AGENT_KNOWLEDGE_MAX_BYTES + 1,
      }),
    ).toThrow("1GB");
  });

  it("blocks unsupported extensions and mime types", () => {
    expect(() =>
      validateKnowledgeFileInput({
        filename: "script.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 1024,
      }),
    ).toThrow("Extensão");

    expect(() =>
      validateKnowledgeFileInput({
        filename: "fake.pdf",
        mimeType: "application/octet-stream",
        sizeBytes: 1024,
      }),
    ).toThrow("Tipo");
  });
});

describe("extractTextFromDocument", () => {
  it("extracts and normalizes PDF text", async () => {
    const text = await extractTextFromDocument(Buffer.from("%PDF"), "application/pdf", "pdf");
    expect(text).toBe("Conteúdo PDF");
  });

  it("extracts and normalizes DOCX text", async () => {
    const text = await extractTextFromDocument(
      Buffer.from("PK"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    );
    expect(text).toBe("Texto DOCX");
  });

  it("returns null for unsupported formats", async () => {
    const text = await extractTextFromDocument(Buffer.from("x"), "image/png", "png");
    expect(text).toBeNull();
  });
});
