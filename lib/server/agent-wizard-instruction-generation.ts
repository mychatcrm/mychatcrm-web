import "server-only";

import { generateAIResponse } from "@/lib/ai/gateway";
import { buildAgentWizardInstructionsSystemPrompt } from "@/lib/ai/prompts/agent-wizard-instructions-system";
import type { GeneratedAgentInstructions } from "@/lib/agents/wizard-generated-instructions";
import type { AgentWizardDraft } from "@/lib/agents/wizard-model";

export type { GeneratedAgentInstructions };
import {
  extractWizardTempFile,
  validateWizardTempFile,
  WIZARD_TEMP_MAX_EXTRACTED_CHARS,
  WIZARD_TEMP_MAX_FILES,
  WIZARD_TEMP_MAX_TOTAL_BYTES,
  type WizardTempFileInput,
} from "@/lib/server/wizard-temp-file-extract";

export const WIZARD_INSTRUCTION_AGENT_ID = "__wizard__";

export type GenerateWizardInstructionsResult =
  | { ok: true; fields: GeneratedAgentInstructions; fileWarnings: string[] }
  | { ok: false; error: string; code?: string };

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parseia JSON da resposta do modelo (com ou sem fence markdown). */
export function parseWizardInstructionsJson(rawText: string): GeneratedAgentInstructions | null {
  let raw = rawText.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) raw = fence[1].trim();
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    raw = raw.slice(jsonStart, jsonEnd + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const promptIdentidade = asNonEmptyString(o.promptIdentidade);
  const promptObjetivo = asNonEmptyString(o.promptObjetivo);
  const systemPrompt = asNonEmptyString(o.systemPrompt);
  const promptRegrasAdicionais = asNonEmptyString(o.promptRegrasAdicionais) ?? "";
  const respostasProibidas = asNonEmptyString(o.respostasProibidas) ?? "";

  if (!promptIdentidade || !promptObjetivo || !systemPrompt) return null;

  return {
    promptIdentidade,
    promptObjetivo,
    systemPrompt,
    promptRegrasAdicionais,
    respostasProibidas,
  };
}

function buildDraftContextSnippet(draft?: Partial<AgentWizardDraft>): string {
  if (!draft) return "";
  const lines: string[] = [];
  if (draft.nome?.trim()) lines.push(`Nome do agente (formulário): ${draft.nome.trim()}`);
  if (draft.tom?.trim()) lines.push(`Tom de voz: ${draft.tom.trim()}`);
  if (draft.idioma?.trim()) lines.push(`Idioma: ${draft.idioma.trim()}`);
  return lines.length ? `\n\nContexto já preenchido no formulário:\n${lines.join("\n")}` : "";
}

async function buildFileContextBlocks(
  files: WizardTempFileInput[],
): Promise<{ blocks: string[]; warnings: string[] }> {
  const blocks: string[] = [];
  const warnings: string[] = [];
  let charBudget = WIZARD_TEMP_MAX_EXTRACTED_CHARS;

  for (const file of files) {
    const result = await extractWizardTempFile(file, charBudget);
    if (result.warning) warnings.push(`${result.filename}: ${result.warning}`);
    if (result.error) warnings.push(`${result.filename}: ${result.error}`);
    if (result.text) {
      const block = `--- arquivo: ${result.filename} ---\n${result.text}`;
      blocks.push(block);
      charBudget = Math.max(0, charBudget - block.length);
    }
  }

  return { blocks, warnings };
}

export async function generateWizardAgentInstructions(params: {
  tenantId: string;
  description: string;
  files: WizardTempFileInput[];
  draftContext?: Partial<AgentWizardDraft>;
}): Promise<GenerateWizardInstructionsResult> {
  const description = params.description.trim();
  if (!description) {
    return { ok: false, error: "Descreva o negócio ou o agente antes de gerar." };
  }

  if (params.files.length > WIZARD_TEMP_MAX_FILES) {
    return { ok: false, error: `Envie no máximo ${WIZARD_TEMP_MAX_FILES} arquivos.` };
  }

  let totalBytes = 0;
  for (const file of params.files) {
    try {
      validateWizardTempFile({
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.byteLength,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Arquivo inválido." };
    }
    totalBytes += file.buffer.byteLength;
  }

  if (totalBytes > WIZARD_TEMP_MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Tamanho total dos arquivos acima de ${Math.round(WIZARD_TEMP_MAX_TOTAL_BYTES / (1024 * 1024))}MB.`,
    };
  }

  const { blocks, warnings } = await buildFileContextBlocks(params.files);
  const draftSnippet = buildDraftContextSnippet(params.draftContext);

  const userParts = [
    "Descrição do negócio / agente:",
    description,
    draftSnippet,
  ];
  if (blocks.length) {
    userParts.push("\n\nConteúdo extraído dos arquivos anexados:\n", blocks.join("\n\n"));
  }

  const aiResult = await generateAIResponse({
    tenantId: params.tenantId,
    agentId: WIZARD_INSTRUCTION_AGENT_ID,
    feature: "agent_wizard_instructions",
    temperature: 0.3,
    messages: [
      { role: "system", content: buildAgentWizardInstructionsSystemPrompt() },
      { role: "user", content: userParts.join("") },
    ],
    metadata: { fileCount: params.files.length },
  });

  if (!aiResult.ok) {
    const detail = aiResult.detail ?? aiResult.code;
    if (aiResult.code === "UNCONFIGURED") {
      return { ok: false, error: "IA não configurada. Configure a chave OpenAI no painel.", code: aiResult.code };
    }
    if (aiResult.code === "LIMIT_EXCEEDED") {
      return { ok: false, error: "Limite de uso de IA atingido. Tente mais tarde.", code: aiResult.code };
    }
    return { ok: false, error: detail || "Erro ao gerar instruções com IA.", code: aiResult.code };
  }

  const fields = parseWizardInstructionsJson(aiResult.text);
  if (!fields) {
    return {
      ok: false,
      error: "A IA retornou um formato inválido. Tente novamente com uma descrição mais detalhada.",
    };
  }

  return { ok: true, fields, fileWarnings: warnings };
}
