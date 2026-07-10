import { NextResponse } from "next/server";
import { planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { getTenantLeadQuotaSnapshot } from "@/lib/server/lead-quota";
import { ensureAndReadTenantLeadUsage } from "@/lib/server/tenant-lead-usage-db";

export const dynamic = "force-dynamic";

/**
 * Uso de leads atendidos no ciclo mensal (servidor) + tecto do plano.
 */
export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const snapshot = await getTenantLeadQuotaSnapshot({
      tenantId: session.tenantId,
      plan: session.plan,
      operationalLimits: session.operationalLimits,
    });
    return NextResponse.json({
      used: snapshot.used,
      bonus: snapshot.recurringBonus + snapshot.topupBonus,
      cap: snapshot.cap,
      baseLimit: snapshot.baseLimit,
      recurringBonus: snapshot.recurringBonus,
      topupBonus: snapshot.topupBonus,
      periodicity: snapshot.periodicity,
      cycleStart: snapshot.cycleStart,
      cycleEnd: snapshot.cycleEnd,
    });
  } catch (e) {
    console.error("[api/client/lead-usage]", e);
    const cap = planMonthlyLeadAllowance(session.plan, session.operationalLimits);
    const row = await ensureAndReadTenantLeadUsage(session.tenantId).catch(() => ({ used_count: 0, bonus_count: 0 }));
    return NextResponse.json(
      { used: row.used_count, bonus: row.bonus_count, cap: cap + row.bonus_count, baseLimit: cap, degraded: true },
      { status: 200 },
    );
  }
}
