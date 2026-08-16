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
import { getPlanPolicy } from "@/lib/plan-policy";
import {
  BROADCAST_AGENT_COUNT_SELECT,
  isBroadcastAgentProjection,
} from "@/lib/server/broadcast-agent-identity";

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

/** Teto de agentes de Disparos ativos. Cota separada, sem extras compráveis. */
export function resolveActiveBroadcastAgentLimit(session: PlanSession): number {
  const limits = session.operationalLimits;
  const fromProvision = limits?.includedBroadcastAgents;
  if (typeof fromProvision === "number" && Number.isFinite(fromProvision) && fromProvision >= 0) {
    return Math.floor(fromProvision);
  }
  return getPlanPolicy(session.plan).includedBroadcastAgents;
}

/**
 * Mensagem de bloqueio quando ativar este agente passaria do teto do plano,
 * ou `null` quando a operação é permitida.
 *
 * `agentId` é excluído da contagem para que salvar um agente que já está ativo
 * não conte duas vezes.
 *
 * As duas cotas são contadas em separado: um agente de Disparos ativo não
 * consome vaga de atendimento e vice-versa. Antes desta separação, criar o
 * agente de Disparos no plano Solo deixava o cliente com um único agente para
 * atender lead novo.
 */
export async function describeAgentActivationBlock(params: {
  sb: SupabaseServiceClient;
  session: PlanSession;
  agentId: string;
  willBeActive: boolean;
  /**
   * Se o agente que está sendo salvo é de Disparos. O chamador sabe disso pelo
   * payload que está gravando — ler do banco aqui devolveria o estado ANTIGO,
   * errando justamente no momento da criação.
   */
  isBroadcastAgent?: boolean;
}): Promise<string | null> {
  if (!params.willBeActive) return null;

  const broadcast = params.isBroadcastAgent === true;
  const limit = broadcast
    ? resolveActiveBroadcastAgentLimit(params.session)
    : await resolveActiveAgentLimit(params.sb, params.session);

  const { data, error } = await params.sb
    .from("tenant_agents")
    .select(BROADCAST_AGENT_COUNT_SELECT)
    .eq("tenant_id", params.session.tenantId)
    .eq("active", true)
    .neq("agent_id", params.agentId);

  if (error) {
    // Falha de contagem não pode bloquear o cliente de salvar o próprio agente.
    console.warn("[agent-plan-limit] count_failed", error.code ?? "", error.message);
    return null;
  }

  const othersActive = (data ?? []).filter(
    (row) => isBroadcastAgentProjection(row as Record<string, unknown>) === broadcast,
  ).length;
  if (othersActive + 1 <= limit) return null;

  if (broadcast) {
    return `Seu plano permite ${limit} agente${limit === 1 ? "" : "s"} de Disparos ativo${limit === 1 ? "" : "s"} e você já tem ${othersActive}. Pause outro agente de Disparos para ativar este.`;
  }
  return `Seu plano permite ${limit} agente${limit === 1 ? "" : "s"} ativo${limit === 1 ? "" : "s"} ao mesmo tempo e você já tem ${othersActive}. Pause outro agente ou compre agentes extras para ativar este.`;
}
