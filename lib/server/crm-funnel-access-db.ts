/**
 * Funis liberados por colaborador.
 *
 * Regra (confirmada com o operador): liberar funis **não amplia** o que o
 * colaborador enxerga — ele continua vendo apenas os leads sob a sua
 * responsabilidade (`access-scope`). A liberação só restringe em quais funis
 * ele trabalha.
 *
 * Nenhuma liberação = sem restrição por funil, que é o comportamento anterior.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type FunnelAccessByEmployee = Record<string, string[]>;

/**
 * Funis liberados para UM colaborador.
 *
 * `null` = sem restrição por funil (nenhuma liberação configurada) — é o
 * padrão, e mantém o comportamento anterior à Fase 2. Fonte única: tanto o
 * recorte de leads (`access-scope.ts`) quanto a lista de funis que o painel
 * mostra (`GET /api/client/crm/funnels`) chamam esta função, para nunca
 * divergir sobre o que um colaborador tem liberado.
 */
export async function resolveAllowedFunnelIds(
  tenantId: string,
  employeeId: string,
  sb?: SupabaseServiceClient,
): Promise<string[] | null> {
  const client = sb ?? createSupabaseServiceClient();
  const { data, error } = await client
    .from("crm_funnel_access")
    .select("funnel_id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId);

  if (error) {
    // Falha de leitura não pode virar liberação geral nem bloqueio total —
    // ver o mesmo raciocínio em access-scope.ts.
    console.error("[crm-funnel-access] resolve failed", error.code, error.message);
    return null;
  }

  const funnelIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => String((row as { funnel_id: string }).funnel_id).trim())
        .filter(Boolean),
    ),
  );
  return funnelIds.length ? funnelIds : null;
}

export async function listFunnelAccessForTenant(
  tenantId: string,
  sb?: SupabaseServiceClient,
): Promise<FunnelAccessByEmployee> {
  const client = sb ?? createSupabaseServiceClient();
  const { data, error } = await client
    .from("crm_funnel_access")
    .select("employee_id, funnel_id")
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[crm-funnel-access] list failed", error.code, error.message);
    return {};
  }

  const byEmployee: FunnelAccessByEmployee = {};
  for (const row of (data ?? []) as Array<{ employee_id?: unknown; funnel_id?: unknown }>) {
    const employeeId = typeof row.employee_id === "string" ? row.employee_id.trim() : "";
    const funnelId = typeof row.funnel_id === "string" ? row.funnel_id.trim() : "";
    if (!employeeId || !funnelId) continue;
    (byEmployee[employeeId] ??= []).push(funnelId);
  }
  return byEmployee;
}

/**
 * Substitui a liberação de um colaborador. Lista vazia remove a restrição —
 * o colaborador volta a alcançar os leads dele em qualquer funil.
 */
export async function replaceFunnelAccessForEmployee(params: {
  tenantId: string;
  employeeId: string;
  funnelIds: string[];
  sb?: SupabaseServiceClient;
}): Promise<{ ok: boolean }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const funnelIds = Array.from(
    new Set(params.funnelIds.map((id) => id.trim()).filter(Boolean)),
  );

  const { error: deleteError } = await sb
    .from("crm_funnel_access")
    .delete()
    .eq("tenant_id", params.tenantId)
    .eq("employee_id", params.employeeId);

  if (deleteError) {
    console.error("[crm-funnel-access] clear failed", deleteError.code, deleteError.message);
    return { ok: false };
  }

  if (!funnelIds.length) return { ok: true };

  const { error: insertError } = await sb.from("crm_funnel_access").insert(
    funnelIds.map((funnelId) => ({
      tenant_id: params.tenantId,
      employee_id: params.employeeId,
      funnel_id: funnelId,
    })),
  );

  if (insertError) {
    console.error("[crm-funnel-access] insert failed", insertError.code, insertError.message);
    return { ok: false };
  }

  console.info("[crm-funnel-access] updated", {
    tenant_id: params.tenantId,
    employee_id: params.employeeId,
    funnels: funnelIds.length,
  });
  return { ok: true };
}
