/**
 * Regras puras da carteira: chave de idempotência e simulação de saldo.
 *
 * O ledger de verdade vive no Postgres (`credits_move_v1`, transacional). Isto
 * aqui é o que a interface usa para prever o resultado sem gastar, e o que os
 * testes usam para provar que a matemática nunca deixa o saldo negativo.
 */

import type { CreditAction } from "@/lib/credits/pricing";
import { creditCostForAction } from "@/lib/credits/pricing";

export type CreditMoveReasonCode = "ok" | "duplicate" | "insufficient" | "zero_delta";

export type CreditMoveResult = {
  applied: boolean;
  balance: number;
  reasonCode: CreditMoveReasonCode;
};

/**
 * A chave que impede cobrar duas vezes.
 *
 * Tem de ser estável para a MESMA intenção e diferente para intenções
 * diferentes. Por isso entra o alvo (a página) e um discriminador de tentativa:
 * gerar a mesma página de novo, de propósito, é uma intenção nova e deve
 * custar; o duplo clique no mesmo botão, não.
 */
export function buildCreditIdempotencyKey(params: {
  action: CreditAction | string;
  tenantId: string;
  refId?: string | null;
  attemptToken: string;
}): string {
  const parts = [
    String(params.action ?? "").trim(),
    String(params.tenantId ?? "").trim(),
    String(params.refId ?? "-").trim() || "-",
    String(params.attemptToken ?? "").trim(),
  ];
  return parts.join(":").slice(0, 200);
}

/** Chave do crédito comprado: o evento do Stripe é a intenção, e ele repete. */
export function buildPurchaseIdempotencyKey(stripeEventOrSessionId: string): string {
  return `stripe:${String(stripeEventOrSessionId ?? "").trim()}`.slice(0, 200);
}

/**
 * Simula o movimento — a mesma decisão que o Postgres vai tomar.
 *
 * Existe para a interface poder dizer "faltam 2 créditos" antes de o utilizador
 * clicar, sem inventar uma segunda regra que possa divergir da real.
 */
export function simulateCreditMove(params: {
  balance: number;
  delta: number;
  alreadyApplied?: boolean;
}): CreditMoveResult {
  const balance = Math.max(0, Math.floor(params.balance ?? 0));
  const delta = Math.floor(params.delta ?? 0);

  if (params.alreadyApplied) {
    return { applied: false, balance, reasonCode: "duplicate" };
  }
  if (delta === 0) {
    return { applied: false, balance, reasonCode: "zero_delta" };
  }
  if (delta < 0 && balance + delta < 0) {
    return { applied: false, balance, reasonCode: "insufficient" };
  }
  return { applied: true, balance: balance + delta, reasonCode: "ok" };
}

export type CreditAffordability = {
  affordable: boolean;
  cost: number;
  balance: number;
  missing: number;
};

export function canAffordAction(params: {
  action: CreditAction;
  balance: number;
}): CreditAffordability {
  const cost = creditCostForAction(params.action);
  const balance = Math.max(0, Math.floor(params.balance ?? 0));
  const missing = Math.max(0, cost - balance);
  return { affordable: missing === 0, cost, balance, missing };
}

export function creditMoveMessage(result: CreditMoveResult, action?: CreditAction): string {
  switch (result.reasonCode) {
    case "ok":
      return "Crédito debitado.";
    case "duplicate":
      return "Esta ação já tinha sido feita — nada foi cobrado de novo.";
    case "insufficient": {
      const cost = action ? creditCostForAction(action) : 0;
      const missing = Math.max(0, cost - result.balance);
      return missing > 0
        ? `Saldo insuficiente: faltam ${missing} crédito${missing === 1 ? "" : "s"}.`
        : "Saldo insuficiente.";
    }
    default:
      return "Nenhum movimento a fazer.";
  }
}
