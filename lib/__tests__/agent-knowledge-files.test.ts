import { describe, expect, it, vi } from "vitest";
import {
  AGENT_KNOWLEDGE_MAX_BYTES,
  extractTextFromDocument,
  validateKnowledgeFileInput,
} from "@/lib/server/agent-knowledge-files";

vi.mock("unpdf", () => ({
  extractText: vi.fn(async () => ({ text: "  Conteúdo PDF  \n\n" })),
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
    const result = await extractTextFromDocument(Buffer.from("%PDF"), "application/pdf", "pdf");
    expect(result).toEqual({ text: "Conteúdo PDF", error: null });
  });

  it("extracts and normalizes DOCX text", async () => {
    const result = await extractTextFromDocument(
      Buffer.from("PK"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    );
    expect(result).toEqual({ text: "Texto DOCX", error: null });
  });

  it("returns null text and error for unsupported formats", async () => {
    const result = await extractTextFromDocument(Buffer.from("x"), "image/png", "png");
    expect(result).toEqual({ text: null, error: null });
  });

  it("returns error payload when extraction throws", async () => {
    const { extractText } = await import("unpdf");
    vi.mocked(extractText).mockRejectedValueOnce(new Error("pdf boom"));
    const result = await extractTextFromDocument(Buffer.from("%PDF"), "application/pdf", "pdf");
    expect(result.text).toBeNull();
    expect(result.error).toContain("pdf boom");
    expect(result.error).toContain("|");
  });
});
