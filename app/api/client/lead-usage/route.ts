import { NextResponse } from "next/server";
import { planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
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

  const cap = planMonthlyLeadAllowance(session.plan, session.operationalLimits);

  try {
    const row = await ensureAndReadTenantLeadUsage(session.tenantId);
    return NextResponse.json({
      used: row.used_count,
      bonus: row.bonus_count,
      cap,
    });
  } catch (e) {
    console.error("[api/client/lead-usage]", e);
    return NextResponse.json(
      { used: 0, bonus: 0, cap, degraded: true },
      { status: 200 },
    );
  }
}
