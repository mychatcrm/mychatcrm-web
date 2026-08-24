import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_CHUNK_TOKENS,
  chunkKnowledgeText,
  createLocalKnowledgeEmbedding,
  extractKnowledgeText,
} from "@/lib/server/agent-knowledge-processing";
import { buildKnowledgeRetrievalQuery } from "@/lib/server/conversation-memory";

vi.mock("unpdf", () => ({
  extractText: vi.fn(async () => ({ text: ["Conteúdo da primeira página"] })),
}));

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(async () => ({ value: "Conteúdo DOCX" })),
}));

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({ data: { text: "Texto da imagem" } })),
    terminate: vi.fn(async () => undefined),
  })),
}));

describe("agent knowledge local processing", () => {
  it("chunks long multilingual content without exceeding the configured token size", () => {
    const source = Array.from(
      { length: 1500 },
      (_, index) => `Item ${index}: disponibilidade 教育 logística الصحة tecnología.`,
    ).join("\n");
    const chunks = chunkKnowledgeText(source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= KNOWLEDGE_CHUNK_TOKENS)).toBe(true);
    expect(chunks.every((chunk) => chunk.content.length > 0)).toBe(true);
  });

  it("creates deterministic normalized local embeddings without external calls", () => {
    const first = createLocalKnowledgeEmbedding("estoque disponível 東京");
    const second = createLocalKnowledgeEmbedding("estoque disponível 東京");
    expect(first).toEqual(second);
    expect(first).toHaveLength(1536);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 8);
  });

  it("extracts and cleans plain text locally", async () => {
    await expect(
      extractKnowledgeText({
        buffer: Buffer.from("Linha 1\r\nLinha 2\n\n\n\nLinha 3", "utf8"),
        filename: "base.txt",
        mimeType: "text/plain",
      }),
    ).resolves.toBe("Linha 1\nLinha 2\n\n\nLinha 3");
  });

  it("rejects a fake PDF before invoking the parser", async () => {
    await expect(
      extractKnowledgeText({
        buffer: Buffer.from("not a pdf", "utf8"),
        filename: "fake.pdf",
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow("knowledge_pdf_signature_invalid");
  });

  it("extracts PDF, DOCX, XLSX, PPTX and image content through their local handlers", async () => {
    const docx = new JSZip();
    docx.file("word/document.xml", "<w:document><w:body><w:p/></w:body></w:document>");
    const docxBuffer = await docx.generateAsync({ type: "nodebuffer" });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Código", "Disponível"], ["A1", "Sim"]]), "Dados");
    const xlsxBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const pptx = new JSZip();
    pptx.file("ppt/slides/slide1.xml", "<p:sld><a:t>Conteúdo PPTX</a:t></p:sld>");
    const pptxBuffer = await pptx.generateAsync({ type: "nodebuffer" });

    const pngBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("mock"),
    ]);

    await expect(
      extractKnowledgeText({ buffer: Buffer.from("%PDF-1.4 mock"), filename: "base.pdf", mimeType: "application/pdf" }),
    ).resolves.toContain("Conteúdo da primeira página");
    await expect(
      extractKnowledgeText({
        buffer: docxBuffer,
        filename: "base.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).resolves.toBe("Conteúdo DOCX");
    await expect(
      extractKnowledgeText({
        buffer: xlsxBuffer,
        filename: "base.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).resolves.toContain("A1\tSim");
    await expect(
      extractKnowledgeText({
        buffer: pptxBuffer,
        filename: "base.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    ).resolves.toContain("Conteúdo PPTX");
    await expect(
      extractKnowledgeText({ buffer: pngBuffer, filename: "base.png", mimeType: "image/png" }),
    ).resolves.toBe("Texto da imagem");
  });

  it("removes markup scripts and retains visible HTML/XML facts", async () => {
    await expect(
      extractKnowledgeText({
        buffer: Buffer.from("<html><script>ignore()</script><p>Informação segura</p></html>"),
        filename: "base.html",
        mimeType: "text/html",
      }),
    ).resolves.toBe("Informação segura");
  });
});

describe("knowledge retrieval query", () => {
  const recent = [
    { id: "1", role: "user" as const, content: "primeira", kind: "text" as const, createdAt: "1" },
    { id: "2", role: "assistant" as const, content: "resposta", kind: "text" as const, createdAt: "2" },
    { id: "3", role: "user" as const, content: "segunda", kind: "text" as const, createdAt: "3" },
    { id: "4", role: "user" as const, content: "terceira", kind: "text" as const, createdAt: "4" },
    { id: "5", role: "user" as const, content: "quarta", kind: "text" as const, createdAt: "5" },
  ];

  it("prefers the consolidated current turn", () => {
    expect(buildKnowledgeRetrievalQuery("consulta atual", recent)).toBe("consulta atual");
  });

  it("falls back to the last three user messages in their original order", () => {
    expect(buildKnowledgeRetrievalQuery(null, recent)).toBe("segunda\nterceira\nquarta");
  });
});
