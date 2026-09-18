/**
 * Carteira de créditos: saldo, extrato e vitrine de pacotes.
 */
import { NextResponse } from "next/server";
import {
  CREDIT_ACTION_COST,
  CREDIT_ACTION_LABEL,
  CREDIT_PACKS,
  creditUnitPriceBRL,
} from "@/lib/credits/pricing";
import { requireLandingAccess } from "@/lib/server/landing-page-guard";
import { getCreditWallet, listCreditLedger } from "@/lib/server/credits";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireLandingAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, canManage } = guard;

  const [wallet, ledger] = await Promise.all([
    getCreditWallet(session.tenantId, sb),
    listCreditLedger({ tenantId: session.tenantId, client: sb }),
  ]);

  return NextResponse.json(
    {
      wallet,
      canManage,
      entries: ledger.entries.map((entry) => ({
        ...entry,
        label:
          CREDIT_ACTION_LABEL[entry.reason as keyof typeof CREDIT_ACTION_LABEL] ??
          (entry.delta > 0 ? "Créditos adicionados" : entry.reason),
      })),
      packs: CREDIT_PACKS.map((pack) => ({
        code: pack.code,
        title: pack.title,
        credits: pack.credits,
        priceBRL: pack.priceBRL,
        unitPriceBRL: creditUnitPriceBRL(pack),
        highlight: pack.highlight === true,
      })),
      costs: CREDIT_ACTION_COST,
      labels: CREDIT_ACTION_LABEL,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
