/**
 * Incremento de leads «atendidos» no ciclo mensal (UTC).
 *
 * Chame apenas a partir de Route Handlers, Server Actions ou jobs internos depois de validar o evento
 * (ex.: primeira resposta humana/IA a um contacto, lead criado no servidor, webhook Meta/WhatsApp).
 * Não exponha isto ao browser sem autenticação forte.
 *
 * @see supabase/migrations/20260512_tenant_lead_usage.sql — função SQL `increment_tenant_lead_usage`
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCycleMonthUTC } from "@/lib/server/tenant-lead-usage-db";

export async function incrementTenantLeadUsageAttended(tenantId: string, delta = 1): Promise<void> {
  const d = Math.floor(delta);
  if (!tenantId || d < 1) return;

  const sb = createSupabaseServiceClient();
  const { error } = await sb.rpc("increment_tenant_lead_usage", {
    p_tenant_id: tenantId,
    p_cycle_month: currentCycleMonthUTC(),
    p_delta: d,
  });

  if (error) {
    throw new Error(`[tenant-lead-usage-increment] ${error.message}`);
  }
}
