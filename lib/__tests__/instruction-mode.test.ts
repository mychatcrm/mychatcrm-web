import { describe, expect, it } from "vitest";
import {
  assembleStoredSystemPrompt,
  buildSimplePromptFromProFields,
  normalizeInstructionMode,
} from "@/lib/agents/instruction-mode";
import type { Agent } from "@/lib/types";

describe("instruction mode helpers", () => {
  it("defaults unknown modes to pro", () => {
    expect(normalizeInstructionMode(undefined)).toBe("pro");
    expect(normalizeInstructionMode("invalid")).toBe("pro");
    expect(normalizeInstructionMode("simple")).toBe("simple");
  });

  it("concatenates only filled pro sections", () => {
    const text = buildSimplePromptFromProFields({
      promptIdentidade: "Sou a Ana",
      promptObjetivo: "",
      systemPrompt: "Seja breve",
      respostasProibidas: "Sem descontos",
    });
    expect(text).toContain("[Identidade]\nSou a Ana");
    expect(text).toContain("[Instruções]\nSeja breve");
    expect(text).toContain("[Respostas proibidas]\nSem descontos");
    expect(text).not.toContain("[Objetivo]");
  });

  it("stores simple prompt in system_prompt column when in simple mode", () => {
    const agent = {
      instructionMode: "simple",
      simplePrompt: "Atenda com empatia e sem prometer prazos.",
      systemPrompt: "legado",
      promptIdentidade: "ignorar",
    } as Agent;
    expect(assembleStoredSystemPrompt(agent)).toBe("Atenda com empatia e sem prometer prazos.");
  });

  it("stores the pro system prompt once instead of concatenating the same fields twice", () => {
    const agent = {
      instructionMode: "pro",
      systemPrompt: "Atenda somente com os fatos configurados.",
      promptIdentidade: "Identidade preservada no metadata.",
      promptObjetivo: "Objetivo preservado no metadata.",
      promptRegrasAdicionais: "Regras preservadas no metadata.",
    } as Agent;

    expect(assembleStoredSystemPrompt(agent)).toBe("Atenda somente com os fatos configurados.");
  });
});
