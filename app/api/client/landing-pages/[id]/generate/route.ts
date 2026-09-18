/**
 * Geração do conteúdo por IA — a única ação de página que gasta crédito.
 *
 * Ordem: debita, gera, e **devolve o crédito se a geração não sair**. Cobrar por
 * texto que não chegou é a forma mais rápida de destruir a confiança na moeda
 * inteira, e o cliente não tem como provar que não recebeu.
 */
// operational-audit: reconciled — recordLandingAudit (lib/server/landing-audit.ts) regista dinheiro, exposição pública e captação.
import { NextResponse } from "next/server";
import { canAffordAction, creditMoveMessage } from "@/lib/credits/ledger";
import { creditCostForAction } from "@/lib/credits/pricing";
import {
  debitCreditsForAction,
  getCreditWallet,
  refundCreditsForAction,
} from "@/lib/server/credits";
import { landingActorLabel, requireLandingAccess } from "@/lib/server/landing-page-guard";
import {
  getLandingPage,
  getLandingVersion,
  insertLandingVersion,
  setLandingDraftVersion,
} from "@/lib/server/landing-pages-db";
import { recordLandingAudit } from "@/lib/server/landing-audit";
import {
  generateLandingContent,
  loadLandingAgentContext,
} from "@/lib/server/landing-generate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await requireLandingAccess({ manageOnly: true });
  if (!guard.ok) return guard.response;
  const { session, sb } = guard;

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id, client: sb });
  if (!page) return NextResponse.json({ error: "Página não encontrada." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const asVariant = body.variant === true;
  const action = asVariant ? "landing_generate_variant" : "landing_generate_page";

  /**
   * Token da tentativa. Vem do cliente para o duplo clique reutilizar o mesmo
   * (e não cobrar duas vezes); sem ele, cada pedido é uma intenção nova.
   */
  const attemptToken =
    typeof body.attemptToken === "string" && body.attemptToken.trim()
      ? body.attemptToken.trim().slice(0, 80)
      : `${Date.now()}`;

  const wallet = await getCreditWallet(session.tenantId, sb);
  if (!wallet.available) {
    return NextResponse.json(
      { error: "Carteira de créditos ainda não disponível. Aplique as migrações.", code: "SCHEMA_MISSING" },
      { status: 503 },
    );
  }

  const affordability = canAffordAction({ action, balance: wallet.balance });
  if (!affordability.affordable) {
    return NextResponse.json(
      {
        error: `Saldo insuficiente: faltam ${affordability.missing} crédito${affordability.missing === 1 ? "" : "s"}.`,
        code: "INSUFFICIENT_CREDITS",
        cost: affordability.cost,
        balance: affordability.balance,
      },
      { status: 402 },
    );
  }

  const debit = await debitCreditsForAction({
    tenantId: session.tenantId,
    action,
    attemptToken,
    refId: page.id,
    actor: landingActorLabel(session),
    client: sb,
  });

  if (!debit.applied) {
    if (debit.reasonCode !== "duplicate") {
      return NextResponse.json(
        { error: creditMoveMessage(debit, action), code: "INSUFFICIENT_CREDITS", balance: debit.balance },
        { status: 402 },
      );
    }

    /**
     * Esta tentativa já tinha sido cobrada. Devolve o que ela produziu em vez
     * de gerar outra vez: seguir em frente aqui dava geração ilimitada de
     * graça a quem repetisse o pedido com o mesmo token.
     */
    const existing = page.draftVersionId
      ? await getLandingVersion({ versionId: page.draftVersionId, client: sb })
      : null;

    return NextResponse.json({
      version: existing,
      balance: debit.balance,
      creditsSpent: 0,
      duplicate: true,
      message: "Esta geração já tinha sido feita — nada foi cobrado de novo.",
    });
  }

  const context = await loadLandingAgentContext({
    tenantId: session.tenantId,
    agentId: typeof body.agentId === "string" ? body.agentId : null,
    client: sb,
  });

  if (typeof body.businessName === "string" && body.businessName.trim()) {
    context.businessName = body.businessName.trim();
  }
  if (typeof body.proposition === "string" && body.proposition.trim()) {
    context.proposition = body.proposition.trim();
  }
  if (typeof body.desiredAction === "string" && body.desiredAction.trim()) {
    context.desiredAction = body.desiredAction.trim();
  }
  if (typeof body.city === "string" && body.city.trim()) context.city = body.city.trim();

  const baseVersion =
    asVariant && page.publishedVersionId
      ? await getLandingVersion({ versionId: page.publishedVersionId, client: sb })
      : page.draftVersionId
        ? await getLandingVersion({ versionId: page.draftVersionId, client: sb })
        : null;

  const generation = await generateLandingContent({
    tenantId: session.tenantId,
    agentId: typeof body.agentId === "string" ? body.agentId : null,
    templateId: typeof body.templateId === "string" ? body.templateId : "direto",
    context,
    brief: typeof body.brief === "string" ? body.brief : null,
    variantOf: asVariant ? baseVersion?.content ?? null : null,
  });

  if (!generation.ok) {
    const refund = await refundCreditsForAction({
      tenantId: session.tenantId,
      action,
      attemptToken,
      refId: page.id,
      client: sb,
    });
    recordLandingAudit({
      tenantId: session.tenantId,
      action: "credits_refunded",
      resourceId: page.id,
      status: "error",
      severity: "warning",
      resultCode: generation.reason,
      idempotencyKey: attemptToken,
      metadata: { creditAction: action, refunded: refund.applied },
    });

    return NextResponse.json(
      {
        error: "Não foi possível gerar o conteúdo agora. O crédito foi devolvido.",
        code: generation.reason,
        balance: refund.applied ? refund.balance : debit.balance,
      },
      { status: 503 },
    );
  }

  const version = await insertLandingVersion({
    sb,
    tenantId: session.tenantId,
    pageId: page.id,
    content: generation.content,
    origin: "ai",
    creditsSpent: creditCostForAction(action),
    variantLabel: asVariant
      ? (typeof body.variantLabel === "string" && body.variantLabel.trim()
          ? body.variantLabel.trim().slice(0, 40)
          : "Variante B")
      : null,
    createdBy: landingActorLabel(session),
  });

  if (!version) {
    const refund = await refundCreditsForAction({
      tenantId: session.tenantId,
      action,
      attemptToken,
      refId: page.id,
      client: sb,
    });
    return NextResponse.json(
      { error: "Conteúdo gerado mas não foi possível guardar. O crédito foi devolvido.", balance: refund.balance },
      { status: 500 },
    );
  }

  await setLandingDraftVersion({
    tenantId: session.tenantId,
    pageId: page.id,
    versionId: version.id,
    client: sb,
  });

  recordLandingAudit({
    tenantId: session.tenantId,
    actorId: landingActorLabel(session),
    action: "credits_spent",
    resourceId: page.id,
    idempotencyKey: attemptToken,
    metadata: {
      creditAction: action,
      credits: creditCostForAction(action),
      balanceAfter: debit.balance,
      versionId: version.id,
    },
  });

  return NextResponse.json({
    version,
    balance: debit.balance,
    creditsSpent: creditCostForAction(action),
  });
}
