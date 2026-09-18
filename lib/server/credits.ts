import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  buildCreditIdempotencyKey,
  type CreditMoveReasonCode,
  type CreditMoveResult,
} from "@/lib/credits/ledger";
import { creditCostForAction, type CreditAction } from "@/lib/credits/pricing";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Tabela ou função ainda não migrada — o módulo degrada em vez de derrubar a rota. */
const MISSING_SCHEMA_CODES = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

export function isCreditsSchemaMissing(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code));
}

export type CreditWalletSnapshot = {
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  /** `false` quando a migração ainda não correu: a interface avisa em vez de mentir saldo. */
  available: boolean;
};

export async function getCreditWallet(
  tenantId: string,
  client?: SupabaseServiceClient,
): Promise<CreditWalletSnapshot> {
  const sb = client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("credit_wallets")
    .select("balance, lifetime_granted, lifetime_spent")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    if (isCreditsSchemaMissing(error)) {
      return { balance: 0, lifetimeGranted: 0, lifetimeSpent: 0, available: false };
    }
    console.error("[credits] leitura da carteira falhou", error);
    return { balance: 0, lifetimeGranted: 0, lifetimeSpent: 0, available: false };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    balance: Math.max(0, Number(row.balance ?? 0)),
    lifetimeGranted: Math.max(0, Number(row.lifetime_granted ?? 0)),
    lifetimeSpent: Math.max(0, Number(row.lifetime_spent ?? 0)),
    available: true,
  };
}

type MoveOutcome = CreditMoveResult & { available: boolean };

/**
 * Movimento de saldo. Toda a decisão (duplicado, saldo insuficiente) é do
 * Postgres, numa transação — aqui só se traduz a resposta. Duas abas do mesmo
 * cliente clicando ao mesmo tempo não podem gastar o mesmo crédito duas vezes,
 * e isso só a linha travada no banco garante.
 */
async function moveCredits(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
  refType?: string | null;
  refId?: string | null;
  actor?: string | null;
}): Promise<MoveOutcome> {
  const { data, error } = await params.sb.rpc("credits_move_v1", {
    p_tenant_id: params.tenantId,
    p_delta: params.delta,
    p_reason: params.reason,
    p_idempotency_key: params.idempotencyKey,
    p_ref_type: params.refType ?? null,
    p_ref_id: params.refId ?? null,
    p_actor: params.actor ?? null,
  });

  if (error) {
    if (isCreditsSchemaMissing(error)) {
      return { applied: false, balance: 0, reasonCode: "insufficient", available: false };
    }
    console.error("[credits] movimento falhou", error);
    return { applied: false, balance: 0, reasonCode: "insufficient", available: true };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    applied: row?.applied === true,
    balance: Math.max(0, Number(row?.balance ?? 0)),
    reasonCode: (String(row?.reason_code ?? "insufficient") as CreditMoveReasonCode),
    available: true,
  };
}

export type DebitCreditsParams = {
  tenantId: string;
  action: CreditAction;
  /**
   * Discriminador da tentativa. Duas intenções diferentes precisam de tokens
   * diferentes; o mesmo botão clicado duas vezes precisa do mesmo token.
   */
  attemptToken: string;
  refId?: string | null;
  actor?: string | null;
  client?: SupabaseServiceClient;
};

export async function debitCreditsForAction(params: DebitCreditsParams): Promise<MoveOutcome> {
  const sb = params.client ?? createSupabaseServiceClient();
  const cost = creditCostForAction(params.action);
  if (cost <= 0) {
    const wallet = await getCreditWallet(params.tenantId, sb);
    return { applied: true, balance: wallet.balance, reasonCode: "ok", available: wallet.available };
  }

  return moveCredits({
    sb,
    tenantId: params.tenantId,
    delta: -cost,
    reason: params.action,
    idempotencyKey: buildCreditIdempotencyKey({
      action: params.action,
      tenantId: params.tenantId,
      refId: params.refId ?? null,
      attemptToken: params.attemptToken,
    }),
    refType: "landing_action",
    refId: params.refId ?? null,
    actor: params.actor ?? null,
  });
}

/**
 * Devolve crédito quando a ação paga falhou depois do débito.
 *
 * Cliente não pode pagar por geração que não saiu. A chave carrega o sufixo
 * `:refund` para não colidir com o débito original.
 */
export async function refundCreditsForAction(params: {
  tenantId: string;
  action: CreditAction;
  attemptToken: string;
  refId?: string | null;
  client?: SupabaseServiceClient;
}): Promise<MoveOutcome> {
  const sb = params.client ?? createSupabaseServiceClient();
  const cost = creditCostForAction(params.action);
  if (cost <= 0) {
    const wallet = await getCreditWallet(params.tenantId, sb);
    return { applied: false, balance: wallet.balance, reasonCode: "zero_delta", available: wallet.available };
  }

  return moveCredits({
    sb,
    tenantId: params.tenantId,
    delta: cost,
    reason: `${params.action}:refund`,
    idempotencyKey: `${buildCreditIdempotencyKey({
      action: params.action,
      tenantId: params.tenantId,
      refId: params.refId ?? null,
      attemptToken: params.attemptToken,
    })}:refund`,
    refType: "landing_refund",
    refId: params.refId ?? null,
    actor: "system",
  });
}

/** Crédito comprado ou concedido pelo admin. Chave vem do Stripe, que repete evento. */
export async function grantCredits(params: {
  tenantId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  refType?: string | null;
  refId?: string | null;
  actor?: string | null;
  client?: SupabaseServiceClient;
}): Promise<MoveOutcome> {
  const amount = Math.floor(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { applied: false, balance: 0, reasonCode: "zero_delta", available: true };
  }
  const sb = params.client ?? createSupabaseServiceClient();
  return moveCredits({
    sb,
    tenantId: params.tenantId,
    delta: amount,
    reason: params.reason,
    idempotencyKey: params.idempotencyKey,
    refType: params.refType ?? "purchase",
    refId: params.refId ?? null,
    actor: params.actor ?? null,
  });
}

export type CreditLedgerEntry = {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
};

export async function listCreditLedger(params: {
  tenantId: string;
  limit?: number;
  client?: SupabaseServiceClient;
}): Promise<{ entries: CreditLedgerEntry[]; available: boolean }> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("credit_ledger")
    .select("id, delta, balance_after, reason, ref_type, ref_id, created_at")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, params.limit ?? 50)));

  if (error) {
    if (isCreditsSchemaMissing(error)) return { entries: [], available: false };
    console.error("[credits] leitura do extrato falhou", error);
    return { entries: [], available: false };
  }

  const entries = (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      delta: Number(row.delta ?? 0),
      balanceAfter: Number(row.balance_after ?? 0),
      reason: String(row.reason ?? ""),
      refType: typeof row.ref_type === "string" ? row.ref_type : null,
      refId: typeof row.ref_id === "string" ? row.ref_id : null,
      createdAt: String(row.created_at ?? ""),
    };
  });
  return { entries, available: true };
}
