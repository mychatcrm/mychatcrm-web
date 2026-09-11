import type { LabRunRequestV1, LabCheck } from "./contracts";
import { isLabInternalMode } from "./policy";

// Deliberately not an environment flag: enabling these requires code and tests.
const certifiedCapabilities = new Set<string>();
export function requireCertifiedLabCapability(capability: "paid_lab_execution" | "cleanup_ownership"): void {
  if (!certifiedCapabilities.has(capability)) throw new Error(`${capability}_pending`);
}

/** An implemented button is not proof that all its effects are certified. */
export function labSafetyChecks(input: LabRunRequestV1): LabCheck[] {
  if (isLabInternalMode(input.mode)) return [];
  const checks: LabCheck[] = [];
  const check = (code: string, ok: boolean, detail: string) => checks.push({ code, ok, detail });
  check("paid_lab_execution_pending", !["simulation", "autonomous"].includes(input.mode),
    "Simulação e IA testadora aguardam a validação da reserva e contabilização de custos por chamada.");
  check("original_billing_isolation_pending", input.targetKind === "copy",
    "O agente original aguarda a validação da isenção de cobrança e dos efeitos autorizados; use uma cópia isolada.");
  check("meta_form_entry_pending", input.formId === null,
    "O fluxo oficial de formulário ainda precisa ser comprovado; uma mensagem WhatsApp não comprova a entrada Meta.");
  check("context_reuse_pending", !input.reuseTestContext,
    "Reutilização de contexto ainda exige vínculo auditável com a execução anterior.");
  if (["scripted", "correction"].includes(input.mode)) {
    check("script_supported", input.scenario.steps.length > 0 && input.scenario.steps.every(step =>
      step.kind === "wait" ? Number.isInteger(step.waitSeconds) && Number(step.waitSeconds) > 0
        : step.kind === "text" ? Boolean(step.text?.trim()) && step.text!.length <= 4000
        : Boolean(step.assetId) && (step.text?.length ?? 0) <= 1000),
      "O roteiro precisa conter etapas válidas: texto até 4.000 caracteres, mídia com legenda até 1.000 ou espera explícita.");
    check("script_fits_message_limit", input.scenario.steps.filter(step => step.kind !== "wait").length <= input.limits.maxMessages,
      "O limite de mensagens precisa comportar todas as etapas do roteiro.");
    check("script_waits_fit_deadline", input.scenario.steps.reduce((seconds, step) => seconds + (step.kind === "wait" ? step.waitSeconds ?? 0 : 0), 0) < input.limits.maxMinutes * 60,
      "As esperas precisam caber no prazo da execução; o tempo de resposta do agente também conta.");
  }
  return checks;
}

export function labAggregateVerdict(verdicts: string[], plannedSteps: number, settledSteps: number) {
  if (verdicts.includes("failed")) return "failed" as const;
  if (settledSteps < plannedSteps || verdicts.includes("not_executed")) return "not_executed" as const;
  if (verdicts.includes("inconclusive")) return "inconclusive" as const;
  if (verdicts.length && verdicts.every(value => value === "passed" || value === "expected_block")) return "passed" as const;
  return "not_executed" as const;
}
