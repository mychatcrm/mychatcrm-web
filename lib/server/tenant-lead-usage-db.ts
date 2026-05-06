import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type TenantLeadUsageRow = {
  tenant_id: string;
  cycle_month: string;
  used_count: number;
  bonus_count: number;
  updated_at: string;
};

/** Primeiro dia do mês civil em UTC (YYYY-MM-DD). */
export function currentCycleMonthUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * Garante linha para o tenant no mês corrente (used/bonus = 0 se novo) e devolve a linha.
 */
export async function ensureAndReadTenantLeadUsage(tenantId: string): Promise<TenantLeadUsageRow> {
  const sb = createSupabaseServiceClient();
  const cycleMonth = currentCycleMonthUTC();

  const { data: existing, error: selErr } = await sb
    .from("tenant_lead_usage")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("cycle_month", cycleMonth)
    .maybeSingle();

  if (selErr) {
    throw new Error(`[tenant-lead-usage-db] select: ${selErr.message}`);
  }

  if (existing) {
    return existing as TenantLeadUsageRow;
  }

  const { error: insErr } = await sb.from("tenant_lead_usage").insert({
    tenant_id: tenantId,
    cycle_month: cycleMonth,
    used_count: 0,
    bonus_count: 0,
  });

  if (insErr) {
    if (insErr.code === "23505") {
      const { data: again } = await sb
        .from("tenant_lead_usage")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("cycle_month", cycleMonth)
        .single();
      if (again) return again as TenantLeadUsageRow;
    }
    throw new Error(`[tenant-lead-usage-db] insert: ${insErr.message}`);
  }

  return {
    tenant_id: tenantId,
    cycle_month: cycleMonth,
    used_count: 0,
    bonus_count: 0,
    updated_at: new Date().toISOString(),
  };
}
