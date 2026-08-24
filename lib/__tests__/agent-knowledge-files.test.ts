import { describe, expect, it } from "vitest";
import {
  AGENT_KNOWLEDGE_MAX_BYTES,
  validateKnowledgeFileInput,
} from "@/lib/server/agent-knowledge-files";

describe("agent knowledge file validation", () => {
  it("accepts supported documents under the 50 MB limit", () => {
    expect(
      validateKnowledgeFileInput({
        filename: "catalogo.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).toMatchObject({ filename: "catalogo.pdf", mimeType: "application/pdf", ext: "pdf" });
  });

  it("blocks documents above 50 MB", () => {
    expect(() =>
      validateKnowledgeFileInput({
        filename: "grande.pdf",
        mimeType: "application/pdf",
        sizeBytes: AGENT_KNOWLEDGE_MAX_BYTES + 1,
      }),
    ).toThrow("50 MB");
  });

  it("blocks images above 20 MB", () => {
    expect(() =>
      validateKnowledgeFileInput({
        filename: "catalogo.png",
        mimeType: "image/png",
        sizeBytes: 20 * 1024 * 1024 + 1,
      }),
    ).toThrow("20 MB");
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

  it("blocks a supported mime type paired with a different extension", () => {
    expect(() =>
      validateKnowledgeFileInput({
        filename: "imagem.pdf",
        mimeType: "image/png",
        sizeBytes: 1024,
      }),
    ).toThrow("não correspondem");
  });
});
