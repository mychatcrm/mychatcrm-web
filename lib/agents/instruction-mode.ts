import type { Agent } from "@/lib/types";

export type InstructionMode = "simple" | "pro";

export function normalizeInstructionMode(value: unknown): InstructionMode {
  return value === "simple" ? "simple" : "pro";
}

export type ProInstructionFields = {
  promptIdentidade?: string;
  promptObjetivo?: string;
  systemPrompt?: string;
  promptRegrasAdicionais?: string;
  respostasProibidas?: string;
};

/** Concatena campos Pro num único texto (só secções com conteúdo). */
export function buildSimplePromptFromProFields(fields: ProInstructionFields): string {
  const sections: Array<{ title: string; body: string }> = [
    { title: "Identidade", body: fields.promptIdentidade?.trim() ?? "" },
    { title: "Objetivo", body: fields.promptObjetivo?.trim() ?? "" },
    { title: "Instruções", body: fields.systemPrompt?.trim() ?? "" },
    { title: "Regras adicionais", body: fields.promptRegrasAdicionais?.trim() ?? "" },
    { title: "Respostas proibidas", body: fields.respostasProibidas?.trim() ?? "" },
  ];
  return sections
    .filter((section) => section.body.length > 0)
    .map((section) => `[${section.title}]\n${section.body}`)
    .join("\n\n");
}

/** Texto persistido na coluna `system_prompt` do banco. */
export function assembleStoredSystemPrompt(agent: Agent): string {
  const mode = normalizeInstructionMode(agent.instructionMode);
  if (mode === "simple") {
    const simple = agent.simplePrompt?.trim() ?? "";
    if (simple) return simple;
  }
  const parts = [
    agent.systemPrompt,
    agent.promptIdentidade,
    agent.promptObjetivo,
    agent.promptRegrasAdicionais ? `Regras adicionais:\n${agent.promptRegrasAdicionais}` : null,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.join("\n\n");
}

export function agentUsesSimpleInstructions(agent: Partial<Agent>): boolean {
  return normalizeInstructionMode(agent.instructionMode) === "simple" && Boolean(agent.simplePrompt?.trim());
}
