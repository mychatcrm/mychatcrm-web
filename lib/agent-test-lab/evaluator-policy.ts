import type { LabVerdict } from "./contracts";

export type LabEvaluatorOpinion = {
  reading: "consistent" | "inconsistent" | "unclear";
  reasoning: string;
  contradictions: string[];
};

/** The strict shape the evaluator must answer in; anything else is discarded. */
export const LAB_EVALUATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "reasoning", "contradictions"],
  properties: {
    reading: { type: "string", enum: ["consistent", "inconsistent", "unclear"] },
    reasoning: { type: "string", maxLength: 800 },
    contradictions: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
  },
} as const;

/**
 * Reads the evaluator's answer defensively. The evaluator looks at a transcript
 * written partly by the tested agent, so its output is treated as untrusted text:
 * anything outside the schema is dropped rather than shown.
 */
export function parseLabEvaluatorOpinion(raw: unknown): LabEvaluatorOpinion | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const reading = value.reading;
  if (reading !== "consistent" && reading !== "inconsistent" && reading !== "unclear") return null;
  const reasoning = typeof value.reasoning === "string" ? value.reasoning.trim().slice(0, 800) : "";
  if (!reasoning) return null;
  const contradictions = Array.isArray(value.contradictions)
    ? value.contradictions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map(item => item.trim().slice(0, 300)).slice(0, 10)
    : [];
  return { reading, reasoning, contradictions };
}

/**
 * The evaluator never approves and never fails a run.
 *
 * Its reading is advisory by construction: the strongest thing it can say is
 * "inconclusive, worth a look". Determinism decides results; a model's opinion of a
 * transcript is a pointer for a human, and labelling it as anything more would
 * quietly turn a guess into a verdict.
 */
export function labEvaluatorEvidence(opinion: LabEvaluatorOpinion): { verdict: LabVerdict; description: string } {
  const prefix = "Opinião do avaliador (não decide o resultado):";
  if (opinion.reading === "consistent") {
    return { verdict: "not_executed", description: `${prefix} a conversa parece coerente com a configuração. ${opinion.reasoning}` };
  }
  const contradictions = opinion.contradictions.length
    ? ` Pontos a revisar na configuração: ${opinion.contradictions.join(" | ")}`
    : "";
  return {
    verdict: "inconclusive",
    description: `${prefix} ${opinion.reading === "inconsistent" ? "possível incoerência" : "leitura inconclusiva"}. ${opinion.reasoning}${contradictions}`,
  };
}
