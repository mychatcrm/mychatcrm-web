/** Campos de instrução retornados pela API de geração com IA (wizard). */
export type GeneratedAgentInstructions = {
  promptIdentidade: string;
  promptObjetivo: string;
  systemPrompt: string;
  promptRegrasAdicionais: string;
  respostasProibidas: string;
};
