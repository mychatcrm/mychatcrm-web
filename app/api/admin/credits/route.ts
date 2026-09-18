/**
 * Concessão de créditos pelo administrador.
 *
 * Existe porque a carteira nasce em zero: sem isto, um cliente novo não
 * consegue gerar nada até os pacotes estarem configurados no Stripe e ele
 * comprar. Cortesia, compensação por falha e conta de demonstração são casos
 * reais do dia a dia, e nenhum deles passa por um checkout.
 *
 * A chave de idempotência vem de quem chama — assim um duplo clique na tela do
 * admin não concede duas vezes. Cada movimento fica no extrato com o rótulo de
 * quem o fez, então concessão nunca se confunde com compra.
 */
// operational-audit: reconciled — cada concessão fica no credit_ledger com actor e chave de idempotência.
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { getCreditWallet, grantCredits, listCreditLedger } from "@/lib/server/credits";

export const dynamic = "force-dynamic";

const MAX_GRANT = 10_000;

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "financeiro")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const tenantId = new URL(request.url).searchParams.get("tenantId")?.trim() ?? "";
  if (!tenantId) return NextResponse.json({ error: "Informe o tenant." }, { status: 400 });

  const [wallet, ledger] = await Promise.all([
    getCreditWallet(tenantId),
    listCreditLedger({ tenantId, limit: 50 }),
  ]);

  return NextResponse.json(
    { tenantId, wallet, entries: ledger.entries },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "financeiro")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const amount = Math.floor(Number(body.amount));
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim().slice(0, 120)
    : "admin_grant";

  if (!tenantId) return NextResponse.json({ error: "Informe o tenant." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_GRANT) {
    return NextResponse.json(
      { error: `Quantidade inválida. Entre 1 e ${MAX_GRANT}.` },
      { status: 400 },
    );
  }

  /**
   * Sem chave vinda da tela, cada pedido é uma concessão nova — é o lado
   * seguro para o cliente. Com chave, o duplo clique não concede duas vezes.
   */
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? `admin:${body.idempotencyKey.trim().slice(0, 120)}`
      : `admin:${tenantId}:${Date.now()}`;

  const result = await grantCredits({
    tenantId,
    amount,
    reason: `admin_grant:${reason}`,
    idempotencyKey,
    refType: "admin_grant",
    refId: session.email ?? null,
    actor: session.email ?? "admin",
  });

  if (!result.available) {
    return NextResponse.json(
      { error: "Carteira de créditos ainda não migrada neste banco.", code: "SCHEMA_MISSING" },
      { status: 503 },
    );
  }

  if (!result.applied && result.reasonCode === "duplicate") {
    return NextResponse.json({
      granted: false,
      duplicate: true,
      balance: result.balance,
      message: "Esta concessão já tinha sido feita.",
    });
  }

  if (!result.applied) {
    return NextResponse.json({ error: "Não foi possível conceder." }, { status: 500 });
  }

  return NextResponse.json({ granted: true, amount, balance: result.balance });
}
