import { describe, expect, it } from "vitest";
import { parseWizardInstructionsJson } from "@/lib/server/agent-wizard-instruction-generation";
import {
  validateWizardTempFile,
  WIZARD_TEMP_MAX_FILE_BYTES,
  WIZARD_TEMP_MAX_FILES,
} from "@/lib/server/wizard-temp-file-extract";

describe("parseWizardInstructionsJson", () => {
  const valid = {
    promptIdentidade: "Sou a assistente da Loja X.",
    promptObjetivo: "Qualificar leads e agendar demonstrações.",
    systemPrompt: "Pergunte nome, segmento e urgência antes de ofertar preço.",
    promptRegrasAdicionais: "Máximo 3 itens por lista.",
    respostasProibidas: "Não mencionar concorrentes.",
  };

  it("parses plain JSON", () => {
    expect(parseWizardInstructionsJson(JSON.stringify(valid))).toEqual(valid);
  });

  it("parses JSON inside markdown fence", () => {
    const wrapped = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseWizardInstructionsJson(wrapped)).toEqual(valid);
  });

  it("returns null when required fields are missing", () => {
    expect(parseWizardInstructionsJson(JSON.stringify({ promptIdentidade: "x" }))).toBeNull();
    expect(parseWizardInstructionsJson("not json")).toBeNull();
  });

  it("defaults optional string fields to empty", () => {
    const minimal = {
      promptIdentidade: "Id",
      promptObjetivo: "Obj",
      systemPrompt: "Inst",
    };
    expect(parseWizardInstructionsJson(JSON.stringify(minimal))).toMatchObject({
      promptRegrasAdicionais: "",
      respostasProibidas: "",
    });
  });
});

describe("validateWizardTempFile", () => {
  it("accepts pdf under per-file limit", () => {
    expect(
      validateWizardTempFile({
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).toMatchObject({ ext: "pdf" });
  });

  it("rejects unsupported extension", () => {
    expect(() =>
      validateWizardTempFile({
        filename: "virus.exe",
        mimeType: "application/octet-stream",
        sizeBytes: 100,
      }),
    ).toThrow("Extensão");
  });

  it("rejects file above per-file limit", () => {
    expect(() =>
      validateWizardTempFile({
        filename: "big.pdf",
        mimeType: "application/pdf",
        sizeBytes: WIZARD_TEMP_MAX_FILE_BYTES + 1,
      }),
    ).toThrow("limite");
  });
});

describe("wizard temp file limits", () => {
  it("exports max 10 files constant", () => {
    expect(WIZARD_TEMP_MAX_FILES).toBe(10);
  });
});
