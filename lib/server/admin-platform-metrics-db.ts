/**
 * Camada de acesso a dados REAIS para as métricas agregadas da plataforma (`/admin`, `/admin/analytics`).
 *
 * Substitui as fórmulas determinísticas que existiam em `lib/admin-platform-metrics.ts` por queries
 * reais sobre Supabase (tenants, agentes, uso de IA, mensagens, sessões, integrações, automações,
 * origem de leads) e Stripe (MRR/ARR de assinaturas ativas + receita real de charges/invoices via
 * `getFinanceAggregate`). Onde não existe fonte real (ex.: retenção por cohort), as funções deste
 * arquivo simplesmente não inventam números — o chamador decide mostrar "sem dados".
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { estimateMonthlyFromSubscription, getFinanceAggregate } from "@/lib/server/admin-stripe-metrics";

// ── Tenants + agentes ────────────────────────────────────────────────────

export type RealTenantRow = {
  id: string;
  billingPlan: string;
  status: string;
  createdAt: string;
  agentsTotal: number;
  /** Agentes com `tenant_agents.active = true` (configuração, não uso no período). */
  agentsActiveConfig: number;
  agentsInactive: number;
};

export async function fetchRealTenants(): Promise<RealTenantRow[]> {
  const sb = createSupabaseAdminClient();
  const [{ data: tenantsData, error: tErr }, { data: agentsData, error: aErr }] = await Promise.all([
    sb.from("tenants").select("id,billing_plan,status,created_at"),
    sb.from("tenant_agents").select("tenant_id,active"),
  ]);
  if (tErr) console.error("[admin-platform-metrics-db] fetchRealTenants tenants:", tErr.message);
  if (aErr) console.error("[admin-platform-metrics-db] fetchRealTenants tenant_agents:", aErr.message);

  const agentCounts = new Map<string, { total: number; active: number }>();
  for (const row of agentsData ?? []) {
    const key = String(row.tenant_id);
    const cur = agentCounts.get(key) ?? { total: 0, active: 0 };
    cur.total += 1;
    if (row.active) cur.active += 1;
    agentCounts.set(key, cur);
  }

  return (tenantsData ?? []).map((t) => {
    const counts = agentCounts.get(t.id as string) ?? { total: 0, active: 0 };
    return {
      id: t.id as string,
      billingPlan: (t.billing_plan as string) ?? "solo",
      status: (t.status as string) ?? "ativa",
      createdAt: t.created_at as string,
      agentsTotal: counts.total,
      agentsActiveConfig: counts.active,
      agentsInactive: counts.total - counts.active,
    };
  });
}

// ── Uso de IA (ai_usage_logs) ────────────────────────────────────────────

export type RealUsageByTenant = {
  tenantId: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number;
  /** Agentes que tiveram pelo menos 1 chamada de IA no período (definição real de "ativo no período"). */
  activeAgentIds: Set<string>;
};

export async function fetchUsageByTenant(fromISO: string, toISO: string): Promise<Map<string, RealUsageByTenant>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("ai_usage_logs")
    .select("tenant_id,agent_id,input_tokens,output_tokens,total_tokens,estimated_cost_usd")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchUsageByTenant:", error.message);
    return new Map();
  }
  const map = new Map<string, RealUsageByTenant>();
  for (const row of data ?? []) {
    const tenantId = String(row.tenant_id);
    const cur =
      map.get(tenantId) ??
      ({ tenantId, requests: 0, tokensIn: 0, tokensOut: 0, totalTokens: 0, costUsd: 0, activeAgentIds: new Set<string>() } as RealUsageByTenant);
    cur.requests += 1;
    cur.tokensIn += Number(row.input_tokens ?? 0);
    cur.tokensOut += Number(row.output_tokens ?? 0);
    cur.totalTokens += Number(row.total_tokens ?? 0);
    cur.costUsd += Number(row.estimated_cost_usd ?? 0);
    if (row.agent_id) cur.activeAgentIds.add(String(row.agent_id));
    map.set(tenantId, cur);
  }
  return map;
}

// ── Mensagens reais (whatsapp_messages) ──────────────────────────────────

export async function fetchMessagesByTenant(fromISO: string, toISO: string): Promise<Map<string, number>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("tenant_id")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchMessagesByTenant:", error.message);
    return new Map();
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.tenant_id);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** Série diária real de mensagens (para o gráfico "Mensagens por dia"). */
export async function fetchMessagesDailySeries(fromISO: string, toISO: string): Promise<Map<string, number>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("created_at")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchMessagesDailySeries:", error.message);
    return new Map();
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const day = String(row.created_at ?? "").slice(0, 10);
    if (!day) continue;
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return map;
}

export type DailyUsagePoint = { tokensIn: number; tokensOut: number; totalTokens: number; costUsd: number; requests: number };

/** Série diária real de tokens/custo de IA (para o gráfico "Tokens — entrada vs saída" e custo/dia). */
export async function fetchUsageDailySeries(fromISO: string, toISO: string): Promise<Map<string, DailyUsagePoint>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("ai_usage_logs")
    .select("created_at,input_tokens,output_tokens,total_tokens,estimated_cost_usd")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchUsageDailySeries:", error.message);
    return new Map();
  }
  const map = new Map<string, DailyUsagePoint>();
  for (const row of data ?? []) {
    const day = String(row.created_at ?? "").slice(0, 10);
    if (!day) continue;
    const cur = map.get(day) ?? { tokensIn: 0, tokensOut: 0, totalTokens: 0, costUsd: 0, requests: 0 };
    cur.tokensIn += Number(row.input_tokens ?? 0);
    cur.tokensOut += Number(row.output_tokens ?? 0);
    cur.totalTokens += Number(row.total_tokens ?? 0);
    cur.costUsd += Number(row.estimated_cost_usd ?? 0);
    cur.requests += 1;
    map.set(day, cur);
  }
  return map;
}

// ── Sessões reais (conversation_states) ──────────────────────────────────

export type SessionAggregate = { count: number; avgDurationMin: number };

export async function fetchSessionsByTenant(fromISO: string, toISO: string): Promise<Map<string, SessionAggregate>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("conversation_states")
    .select("tenant_id,created_at,last_message_at")
    .gte("last_message_at", fromISO)
    .lte("last_message_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchSessionsByTenant:", error.message);
    return new Map();
  }
  const acc = new Map<string, { count: number; durationsMin: number[] }>();
  for (const row of data ?? []) {
    const key = String(row.tenant_id);
    const cur = acc.get(key) ?? { count: 0, durationsMin: [] };
    cur.count += 1;
    const start = row.created_at ? new Date(row.created_at as string).getTime() : null;
    const end = row.last_message_at ? new Date(row.last_message_at as string).getTime() : null;
    if (start != null && end != null && end > start) {
      cur.durationsMin.push((end - start) / 60_000);
    }
    acc.set(key, cur);
  }
  const out = new Map<string, SessionAggregate>();
  for (const [key, v] of acc) {
    const avg = v.durationsMin.length ? v.durationsMin.reduce((s, n) => s + n, 0) / v.durationsMin.length : 0;
    out.set(key, { count: v.count, avgDurationMin: Math.round(avg * 10) / 10 });
  }
  return out;
}

// ── Integrações reais (tenant_evolution_instances) ───────────────────────

export async function fetchActiveIntegrationsByTenant(): Promise<Map<string, number>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("tenant_id,connection_state")
    .eq("connection_state", "open");
  if (error) {
    console.error("[admin-platform-metrics-db] fetchActiveIntegrationsByTenant:", error.message);
    return new Map();
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.tenant_id);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// ── Automações reais (agent_followup_events) ─────────────────────────────

export async function fetchAutomationsByTenant(fromISO: string, toISO: string): Promise<Map<string, number>> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("agent_followup_events")
    .select("tenant_id")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchAutomationsByTenant:", error.message);
    return new Map();
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.tenant_id);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// ── Aquisição real (tenants.created_at) ───────────────────────────────────

export type AcquisitionBucket = { bucket: string; count: number };

export async function fetchTenantAcquisition(fromISO: string, toISO: string): Promise<AcquisitionBucket[]> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.from("tenants").select("created_at").gte("created_at", fromISO).lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchTenantAcquisition:", error.message);
    return [];
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const day = String(row.created_at ?? "").slice(0, 10);
    if (!day) continue;
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// ── MRR/ARR real (Stripe — assinaturas ativas) ────────────────────────────

export type RealMrrArr = { mrrCents: number; arrCents: number; currency: string; byTenantCents: Map<string, number> };

/**
 * MRR/ARR real a partir de assinaturas ativas no Stripe. O detalhe por tenant usa o espelho local
 * `stripe_subscriptions` (tenant_id ↔ subscription_id, populado pelo webhook) para juntar cada
 * assinatura Stripe ao seu tenant — fica vazio/zero por tenant até o webhook gravar assinaturas reais,
 * o que é o comportamento correto (não inventamos uma divisão por workspace sem mapeamento real).
 */
export async function fetchRealMrrArr(): Promise<RealMrrArr> {
  const sb = createSupabaseAdminClient();
  const { data: localSubs, error: localErr } = await sb
    .from("stripe_subscriptions")
    .select("tenant_id,subscription_id")
    .eq("status", "active");
  if (localErr) console.error("[admin-platform-metrics-db] fetchRealMrrArr local subs:", localErr.message);
  const tenantBySubId = new Map<string, string>();
  for (const row of localSubs ?? []) {
    if (row.subscription_id) tenantBySubId.set(String(row.subscription_id), String(row.tenant_id));
  }

  const stripe = getStripe();
  let mrrCents = 0;
  let currency = "brl";
  const byTenantCents = new Map<string, number>();
  let startingAfter: string | undefined;
  let pages = 0;
  while (pages++ < 20) {
    const page = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.items.data.price"],
    });
    for (const sub of page.data) {
      const est = estimateMonthlyFromSubscription(sub);
      if (est) {
        mrrCents += est.cents;
        currency = est.currency ?? currency;
        const tenantId = tenantBySubId.get(sub.id);
        if (tenantId) byTenantCents.set(tenantId, (byTenantCents.get(tenantId) ?? 0) + est.cents);
      }
    }
    if (!(page.has_more ?? false)) break;
    const lastId = page.data[page.data.length - 1]?.id;
    if (!lastId) break;
    startingAfter = lastId;
  }
  return { mrrCents, arrCents: mrrCents * 12, currency, byTenantCents };
}

/** Receita real do período (charges líquidos de reembolso) — reusa o agregador já usado em /admin/financeiro. */
export async function fetchRealRevenue(fromSec: number, toSec: number) {
  return getFinanceAggregate(fromSec, toSec);
}

// ── Performance de agentes real ────────────────────────────────────────────

export type TopAgentRow = {
  agentId: string;
  tenantId: string;
  displayName: string;
  conversasDia: number;
  origemPrincipal: string;
};

export async function fetchTopAgents(fromISO: string, toISO: string): Promise<TopAgentRow[]> {
  const sb = createSupabaseAdminClient();
  const [{ data: agentsData, error: aErr }, { data: msgData, error: mErr }, { data: leadsData, error: lErr }] = await Promise.all([
    sb.from("tenant_agents").select("agent_id,tenant_id,display_name"),
    sb.from("whatsapp_messages").select("agent_id,created_at").gte("created_at", fromISO).lte("created_at", toISO),
    sb.from("leads").select("agent_id,source"),
  ]);
  if (aErr) console.error("[admin-platform-metrics-db] fetchTopAgents agents:", aErr.message);
  if (mErr) console.error("[admin-platform-metrics-db] fetchTopAgents messages:", mErr.message);
  if (lErr) console.error("[admin-platform-metrics-db] fetchTopAgents leads:", lErr.message);

  const days = Math.max(1, Math.round((new Date(toISO).getTime() - new Date(fromISO).getTime()) / 86_400_000) + 1);

  const msgCountByAgent = new Map<string, number>();
  for (const row of msgData ?? []) {
    if (!row.agent_id) continue;
    const key = String(row.agent_id);
    msgCountByAgent.set(key, (msgCountByAgent.get(key) ?? 0) + 1);
  }

  const sourceByAgent = new Map<string, Map<string, number>>();
  for (const row of leadsData ?? []) {
    if (!row.agent_id) continue;
    const agentKey = String(row.agent_id);
    const src = (row.source as string) || "desconhecida";
    const cur = sourceByAgent.get(agentKey) ?? new Map<string, number>();
    cur.set(src, (cur.get(src) ?? 0) + 1);
    sourceByAgent.set(agentKey, cur);
  }

  return (agentsData ?? [])
    .map((a) => {
      const agentId = String(a.agent_id);
      const total = msgCountByAgent.get(agentId) ?? 0;
      const sources = sourceByAgent.get(agentId);
      const origemPrincipal =
        sources && sources.size > 0 ? Array.from(sources.entries()).sort((x, y) => y[1] - x[1])[0][0] : "—";
      return {
        agentId,
        tenantId: String(a.tenant_id),
        displayName: (a.display_name as string) || agentId,
        conversasDia: Math.round((total / days) * 10) / 10,
        origemPrincipal,
      };
    })
    .sort((x, y) => y.conversasDia - x.conversasDia);
}

// ── Origem de leads real ───────────────────────────────────────────────────

export type AgentOriginShare = { origem: string; percentual: number };

export async function fetchAgentOriginShare(): Promise<AgentOriginShare[]> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.from("leads").select("source");
  if (error) {
    console.error("[admin-platform-metrics-db] fetchAgentOriginShare:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const map = new Map<string, number>();
  for (const row of rows) {
    const src = (row.source as string) || "desconhecida";
    map.set(src, (map.get(src) ?? 0) + 1);
  }
  const total = rows.length;
  return Array.from(map.entries())
    .map(([origem, count]) => ({ origem, percentual: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.percentual - a.percentual);
}

// ── Conversas por agente por dia real ──────────────────────────────────────

export type AgentConversationsDailyRow = { dia: string; counts: Record<string, number> };

export async function fetchAgentConversationsDaily(fromISO: string, toISO: string): Promise<AgentConversationsDailyRow[]> {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("agent_id,created_at")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);
  if (error) {
    console.error("[admin-platform-metrics-db] fetchAgentConversationsDaily:", error.message);
    return [];
  }
  const byDay = new Map<string, Record<string, number>>();
  for (const row of data ?? []) {
    const day = String(row.created_at ?? "").slice(0, 10);
    if (!day) continue;
    const agentId = row.agent_id ? String(row.agent_id) : "sem_agente";
    const cur = byDay.get(day) ?? {};
    cur[agentId] = (cur[agentId] ?? 0) + 1;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .map(([dia, counts]) => ({ dia, counts }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

// ── Câmbio USD→BRL (configurável) ──────────────────────────────────────────

/** Taxa administrativa para converter custo real de IA (USD) em BRL no painel. Configurável via env. */
export function getUsdToBrlRate(): number {
  const raw = process.env.AI_COST_USD_BRL_RATE;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5.5;
}
