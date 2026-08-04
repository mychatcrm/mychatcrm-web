/**
 * Leitura e escrita dos funis do CRM no banco.
 *
 * Fonte de verdade a partir de 04/08/2026. Antes disso os funis viviam só no
 * localStorage do navegador de quem os criou — ver a migration
 * `20260804120000_crm_funnels_server_side.sql`.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { migrateFunnelColumns } from "@/lib/crm-funnel-migration";
import type { CrmFunnel, CrmFunnelColumn } from "@/lib/crm-funnels";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function isColumn(value: unknown): value is CrmFunnelColumn {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" && c.id.trim().length > 0 &&
    typeof c.title === "string" && c.title.trim().length > 0
  );
}

function rowToFunnel(row: Record<string, unknown>): CrmFunnel | null {
  const funnelId = typeof row.funnel_id === "string" ? row.funnel_id.trim() : "";
  const nome = typeof row.nome === "string" ? row.nome.trim() : "";
  if (!funnelId || !nome) return null;

  const rawColumns = Array.isArray(row.columns) ? row.columns : [];
  const columns = migrateFunnelColumns(
    rawColumns.filter(isColumn).map((c) => ({ id: c.id.trim(), title: c.title.trim() })),
  );
  return { id: funnelId, nome, columns };
}

export async function listCrmFunnelsFromDb(
  tenantId: string,
  sb?: SupabaseServiceClient,
): Promise<CrmFunnel[]> {
  const client = sb ?? createSupabaseServiceClient();
  const { data, error } = await client
    .from("crm_funnels")
    .select("funnel_id, nome, columns, position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .order("funnel_id", { ascending: true });

  if (error) {
    console.error("[crm-funnels-db] list failed", error.code, error.message);
    return [];
  }

  const funnels: CrmFunnel[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const funnel = rowToFunnel(row);
    if (funnel) funnels.push(funnel);
  }
  return funnels;
}

/**
 * Substitui a lista inteira do tenant pela recebida.
 *
 * Deliberadamente não apaga funis fora da lista quando `funnels` vem vazia —
 * um payload vazio por erro de rede não pode zerar a configuração de CRM de
 * quem está usando o sistema.
 */
export async function replaceCrmFunnelsInDb(params: {
  tenantId: string;
  funnels: CrmFunnel[];
  sb?: SupabaseServiceClient;
}): Promise<{ ok: boolean; error?: string }> {
  const { tenantId } = params;
  const funnels = params.funnels.filter((f) => f.id.trim() && f.nome.trim());
  if (!funnels.length) return { ok: false, error: "empty_funnel_list" };

  const sb = params.sb ?? createSupabaseServiceClient();
  const now = new Date().toISOString();

  const rows = funnels.map((funnel, index) => ({
    tenant_id: tenantId,
    funnel_id: funnel.id.trim(),
    nome: funnel.nome.trim(),
    columns: migrateFunnelColumns(funnel.columns ?? []),
    position: index,
    updated_at: now,
  }));

  const { error: upsertError } = await sb
    .from("crm_funnels")
    .upsert(rows, { onConflict: "tenant_id,funnel_id" });

  if (upsertError) {
    console.error("[crm-funnels-db] upsert failed", upsertError.code, upsertError.message);
    return { ok: false, error: upsertError.message };
  }

  // Remove os que saíram da lista. Só depois do upsert ter dado certo, para
  // nunca deixar o tenant sem nenhum funil. A diferença é calculada em memória
  // em vez de montar um `not in` por string — id de funil é dado de entrada e
  // não deve virar fragmento de query.
  const keep = new Set(rows.map((row) => row.funnel_id));
  const { data: currentRows } = await sb
    .from("crm_funnels")
    .select("funnel_id")
    .eq("tenant_id", tenantId);

  const stale = ((currentRows ?? []) as Array<{ funnel_id?: unknown }>)
    .map((row) => (typeof row.funnel_id === "string" ? row.funnel_id : ""))
    .filter((id) => id && !keep.has(id));

  if (stale.length) {
    const { error: deleteError } = await sb
      .from("crm_funnels")
      .delete()
      .eq("tenant_id", tenantId)
      .in("funnel_id", stale);
    if (deleteError) {
      console.warn("[crm-funnels-db] prune failed", deleteError.code, deleteError.message);
    }
  }

  return { ok: true };
}

/**
 * Grava a lista apenas se o tenant ainda não tem nenhum funil no servidor.
 *
 * É o que traz para o banco, sem intervenção manual, os funis que o titular já
 * tinha criado no navegador antes desta mudança. Corrida entre abas resolve
 * sozinha: quem chegar depois encontra a lista preenchida e não faz nada.
 */
export async function seedCrmFunnelsIfEmpty(params: {
  tenantId: string;
  funnels: CrmFunnel[];
  sb?: SupabaseServiceClient;
}): Promise<{ seeded: boolean; funnels: CrmFunnel[] }> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const existing = await listCrmFunnelsFromDb(params.tenantId, sb);
  if (existing.length > 0) return { seeded: false, funnels: existing };

  const result = await replaceCrmFunnelsInDb({ ...params, sb });
  if (!result.ok) return { seeded: false, funnels: existing };

  console.info("[crm-funnels-db] seeded_from_client", {
    tenant_id: params.tenantId,
    count: params.funnels.length,
  });
  return { seeded: true, funnels: await listCrmFunnelsFromDb(params.tenantId, sb) };
}
