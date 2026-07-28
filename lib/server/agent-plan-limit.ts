/**
 * Limite de agentes ATIVOS por plano, aplicado no servidor.
 *
 * O painel já desabilita o botão «Novo agente» quando o tenant atinge o teto,
 * mas isso não protegia nada: «Copiar» criava um agente sem passar pela
 * checagem e o interruptor de ativo/pausado do cartão chamava o PUT direto.
 * Como toda essa contagem vive no cliente, qualquer chamada à API passava por
 * cima do plano. A regra cobrada é sobre agentes ativos — agentes pausados não
 * consomem atendimento, então criar/duplicar em pausa continua liberado.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import { getPlanIncludedAgentLimitForSession } from "@/lib/plan-limits";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type PlanSession = Pick<ClientSession, "tenantId" | "plan" | "operationalLimits">;

/** Agentes extras comprados via Stripe somam ao teto do plano. */
async function loadExtraAgentsPurchased(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await sb
    .from("stripe_subscriptions")
    .select("extra_agents_purchased")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.warn("[agent-plan-limit] extras_query_failed", error.code ?? "", error.message);
    return 0;
  }
  const extras = Number((data as { extra_agents_purchased?: unknown } | null)?.extra_agents_purchased ?? 0);
  return Number.isFinite(extras) && extras > 0 ? Math.floor(extras) : 0;
}

/** Teto de agentes ativos: incluídos no plano + extras comprados. */
export async function resolveActiveAgentLimit(
  sb: SupabaseServiceClient,
  session: PlanSession,
): Promise<number> {
  const base = getPlanIncludedAgentLimitForSession(session);
  const extras = await loadExtraAgentsPurchased(sb, session.tenantId);
  return base + extras;
}

/**
 * Mensagem de bloqueio quando ativar este agente passaria do teto do plano,
 * ou `null` quando a operação é permitida.
 *
 * `agentId` é excluído da contagem para que salvar um agente que já está ativo
 * não conte duas vezes.
 */
export async function describeAgentActivationBlock(params: {
  sb: SupabaseServiceClient;
  session: PlanSession;
  agentId: string;
  willBeActive: boolean;
}): Promise<string | null> {
  if (!params.willBeActive) return null;

  const limit = await resolveActiveAgentLimit(params.sb, params.session);

  const { count, error } = await params.sb
    .from("tenant_agents")
    .select("agent_id", { count: "exact", head: true })
    .eq("tenant_id", params.session.tenantId)
    .eq("active", true)
    .neq("agent_id", params.agentId);

  if (error) {
    // Falha de contagem não pode bloquear o cliente de salvar o próprio agente.
    console.warn("[agent-plan-limit] count_failed", error.code ?? "", error.message);
    return null;
  }

  const othersActive = count ?? 0;
  if (othersActive + 1 <= limit) return null;

  return `Seu plano permite ${limit} agente${limit === 1 ? "" : "s"} ativo${limit === 1 ? "" : "s"} ao mesmo tempo e você já tem ${othersActive}. Pause outro agente ou compre agentes extras para ativar este.`;
}
