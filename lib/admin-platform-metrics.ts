/**
 * Métricas agregadas da plataforma para o painel administrativo `/admin` e `/admin/analytics`.
 *
 * FONTE DE DADOS: 100% real. Os números são montados em `lib/server/admin-platform-metrics-db.ts`
 * (Supabase: tenants, tenant_agents, ai_usage_logs, whatsapp_messages, conversation_states,
 * tenant_evolution_instances, agent_followup_events, leads; Stripe: assinaturas ativas + charges/
 * invoices via `getFinanceAggregate`). Este arquivo só soma/formata/compara períodos — nenhuma
 * fórmula sintética. Onde não existe fonte real (retenção por cohort, canais web/api), os campos
 * ficam `null`/zerados explicitamente em vez de inventar um valor.
 *
 * Privacidade: identificação por `workspaceRef` (id interno). Não expor nomes de empresas
 * nem e-mails neste payload.
 */

import type { AdminRole } from "@/lib/admin-auth";

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;

export type PlatformChannel = "all" | "whatsapp" | "web" | "api";

/** Slugs reais de `tenants.billing_plan` (CHECK constraint no Supabase). */
export type TenantBillingPlan = "solo" | "equipa" | "escala" | "enterprise";
/** Valores reais de `tenants.status` (CHECK constraint no Supabase). */
export type TenantStatus = "ativa" | "cancelada" | "suspensa";

export type PlatformPlanFilter = "all" | TenantBillingPlan;

export type PlatformMetricsQuery = {
  from: Date;
  to: Date;
  workspaceId: "all" | string;
  channel: PlatformChannel;
  plan: PlatformPlanFilter;
};

export type PlatformTimePoint = {
  dateISO: string;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  revenueBrl: number;
  costIaBrl: number;
  activeWorkspaces: number;
};

export type WorkspaceAggregateRow = {
  workspaceRef: string;
  /** Rótulo administrativo opaco (sem nome fantasia de cliente). */
  label: string;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  sessions: number;
  /** Duração média real de conversa (last_message_at − created_at), em minutos. */
  avgSessionDurationMin: number;
  agentsConfigured: number;
  revenueBrl: number;
  costIaBrl: number;
  marginBrl: number;
  plan: TenantBillingPlan;
  status: TenantStatus;
};

export type PlatformKpis = {
  messagesProcessed: number;
  tokensConsumed: number;
  interactions: number;
  workspacesRegistered: number;
  workspacesActiveInPeriod: number;
  agentsTotal: number;
  agentsActiveInPeriod: number;
  sessionsInPeriod: number;
  avgMessagesPerWorkspace: number;
  avgTokensPerWorkspace: number;
  revenueTotalBrl: number;
  costTotalBrl: number;
  operatingMarginBrl: number;
  growthVsPreviousPct: number | null;
};

export type PlatformChannelShare = { channel: Exclude<PlatformChannel, "all">; messages: number; pct: number };

export type PlatformConsumptionBlock = {
  tokensIn: number;
  tokensOut: number;
  avgDailyMessages: number;
  avgWeeklyMessages: number;
  avgMonthlyMessages: number;
  peakDay: { dateISO: string; messages: number } | null;
  channelShare: PlatformChannelShare[];
  seriesDaily: PlatformTimePoint[];
};

export type PlatformOperationalBlock = {
  agentsTotal: number;
  agentsInactive: number;
  integrationsActive: number;
  automationsExecuted: number;
  sessionsTotal: number;
  avgSessionDurationMin: number;
  /** null = sem fonte real de cohort/histórico de status ainda. */
  retentionPct: number | null;
};

export type PlatformFinancialBlock = {
  revenueTotalBrl: number;
  revenuePreviousBrl: number;
  mrrApproxBrl: number;
  arrApproxBrl: number;
  ticketMedioBrl: number;
  costTotalBrl: number;
  costPerMessageBrl: number;
  costPerMillionTokensBrl: number;
  operatingMarginBrl: number;
  /** Taxa USD→BRL aplicada ao custo de IA (configurável via AI_COST_USD_BRL_RATE). */
  usdToBrlRate: number;
};

export type WorkspaceDirectoryEntry = { ref: string; label: string };

export type AnalyticsExtras = {
  acquisitionBars: { label: string; value: number }[];
  /** null = sem fonte real (sem histórico de cohort/mudança de status). */
  retentionBars: { label: string; value: number }[] | null;
  revenueBars: { label: string; value: number }[];
  topAgents: { nome: string; cliente: string; conversasDia: number; origemPrincipal: string }[];
  agentDistribution: { faixa: string; totalClientes: number }[];
  agentOriginShare: { origem: string; percentual: number }[];
  agentConversationsDaily: { dia: string; counts: Record<string, number> }[];
};

export type PlatformMetricsPayload = {
  workspaceDirectory: WorkspaceDirectoryEntry[];
  meta: {
    generatedAtISO: string;
    range: { fromISO: string; toISO: string };
    previousRange: { fromISO: string; toISO: string };
    workspaceFilter: "all" | string;
    channel: PlatformChannel;
    plan: PlatformPlanFilter;
    dataProvenance: string;
  };
  kpis: PlatformKpis;
  consumption: PlatformConsumptionBlock;
  operational: PlatformOperationalBlock;
  financial: PlatformFinancialBlock;
  workspaces: WorkspaceAggregateRow[];
  analyticsExtras: AnalyticsExtras;
};

function clampRange(from: Date, to: Date): { from: Date; to: Date } {
  let a = from.getTime();
  let b = to.getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) {
    const t = Date.now();
    return { from: new Date(t - 29 * MS_PER_DAY), to: new Date(t) };
  }
  if (a > b) [a, b] = [b, a];
  const maxSpan = MAX_RANGE_DAYS * MS_PER_DAY;
  if (b - a > maxSpan) {
    a = b - maxSpan;
  }
  return { from: new Date(a), to: new Date(b) };
}

export function inclusiveDayCount(from: Date, to: Date): number {
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((utcTo - utcFrom) / MS_PER_DAY) + 1;
}

function eachDayISO(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Range normalizado + range anterior de igual duração — usado pela rota para buscar dados reais antes de agregar. */
export function resolvePlatformRanges(rawFrom: Date, rawTo: Date): {
  from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number;
} {
  const { from, to } = clampRange(rawFrom, rawTo);
  const days = Math.max(1, inclusiveDayCount(from, to));
  const prevTo = new Date(from.getTime() - MS_PER_DAY);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * MS_PER_DAY);
  return { from, to, prevFrom, prevTo, days };
}

// ── Entrada real (montada por admin-platform-metrics-db.ts no route handler) ─────────────────

export type RealPlatformTenant = {
  id: string;
  billingPlan: string;
  status: string;
  createdAt: string;
  agentsTotal: number;
  agentsInactive: number;
};

export type RealPlatformUsage = {
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number;
  requests: number;
  activeAgentIds: Set<string>;
};

export type RealPlatformSession = { count: number; avgDurationMin: number };

export type RealPlatformInput = {
  tenants: RealPlatformTenant[];
  usageByTenant: Map<string, RealPlatformUsage>;
  messagesByTenant: Map<string, number>;
  sessionsByTenant: Map<string, RealPlatformSession>;
  integrationsByTenant: Map<string, number>;
  automationsByTenant: Map<string, number>;
  /** Totais da plataforma no período anterior (mesma duração), para comparação de crescimento. */
  prevMessagesTotal: number;
  messagesDailySeries: Map<string, number>;
  usageDailySeries: Map<string, { tokensIn: number; tokensOut: number; costUsd: number }>;
  /** Dia → receita líquida real (BRL), de `getFinanceAggregate().seriesDaily`. */
  revenueDailySeriesBrl: Map<string, number>;
  revenueCurrentNetCents: number;
  revenuePreviousNetCents: number;
  mrrCents: number;
  arrCents: number;
  mrrByTenantCents: Map<string, number>;
  usdToBrlRate: number;
  analyticsExtras: AnalyticsExtras;
};

export function computePlatformMetricsReal(real: RealPlatformInput, rawQuery: PlatformMetricsQuery): PlatformMetricsPayload {
  const { from, to } = clampRange(rawQuery.from, rawQuery.to);
  const q: PlatformMetricsQuery = { ...rawQuery, from, to };
  const days = Math.max(1, inclusiveDayCount(from, to));
  const prevTo = new Date(from.getTime() - MS_PER_DAY);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * MS_PER_DAY);

  const filtered = real.tenants.filter((t) => {
    if (q.workspaceId !== "all" && t.id !== q.workspaceId) return false;
    if (q.plan !== "all" && t.billingPlan !== q.plan) return false;
    return true;
  });

  // Só WhatsApp tem tracking real hoje. Filtrar por web/api retorna honestamente "sem dados".
  const channelHasData = q.channel === "all" || q.channel === "whatsapp";

  const workspaces: WorkspaceAggregateRow[] = filtered.map((t) => {
    const usage = real.usageByTenant.get(t.id);
    const msgs = channelHasData ? real.messagesByTenant.get(t.id) ?? 0 : 0;
    const session = real.sessionsByTenant.get(t.id);
    const costBrl = Math.round((usage?.costUsd ?? 0) * real.usdToBrlRate * 100) / 100;
    const revenueBrl = Math.round(((real.mrrByTenantCents.get(t.id) ?? 0) / 100) * (days / 30) * 100) / 100;
    return {
      workspaceRef: t.id,
      label: `Workspace · ${t.id}`,
      messages: msgs,
      tokensIn: usage?.tokensIn ?? 0,
      tokensOut: usage?.tokensOut ?? 0,
      sessions: session?.count ?? 0,
      avgSessionDurationMin: session?.avgDurationMin ?? 0,
      agentsConfigured: t.agentsTotal,
      revenueBrl,
      costIaBrl: costBrl,
      marginBrl: Math.round((revenueBrl - costBrl) * 100) / 100,
      plan: (t.billingPlan as TenantBillingPlan) ?? "solo",
      status: (t.status as TenantStatus) ?? "ativa",
    };
  });

  const totals = workspaces.reduce(
    (acc, w) => ({
      messages: acc.messages + w.messages,
      tokensIn: acc.tokensIn + w.tokensIn,
      tokensOut: acc.tokensOut + w.tokensOut,
      sessions: acc.sessions + w.sessions,
      costIaBrl: acc.costIaBrl + w.costIaBrl,
    }),
    { messages: 0, tokensIn: 0, tokensOut: 0, sessions: 0, costIaBrl: 0 },
  );

  const tokensTotal = totals.tokensIn + totals.tokensOut;
  const interactions = filtered.reduce((s, t) => s + (real.usageByTenant.get(t.id)?.requests ?? 0), 0);

  const workspacesRegistered = filtered.length;
  const workspacesActiveInPeriod = filtered.filter((t) => t.status === "ativa").length;
  const agentsTotal = filtered.reduce((s, t) => s + t.agentsTotal, 0);
  const agentsInactive = filtered.reduce((s, t) => s + t.agentsInactive, 0);
  const agentsActiveInPeriod = filtered.reduce(
    (s, t) => s + (real.usageByTenant.get(t.id)?.activeAgentIds.size ?? 0),
    0,
  );

  const revenueTotal = Math.round((real.revenueCurrentNetCents / 100) * 100) / 100;
  const costTotal = Math.round(totals.costIaBrl * 100) / 100;
  const margin = Math.round((revenueTotal - costTotal) * 100) / 100;

  const avgMessages = workspacesRegistered ? Math.round(totals.messages / workspacesRegistered) : 0;
  const avgTokens = workspacesRegistered ? Math.round(tokensTotal / workspacesRegistered) : 0;

  const growthVsPreviousPct =
    real.prevMessagesTotal > 0
      ? Math.round(((totals.messages - real.prevMessagesTotal) / real.prevMessagesTotal) * 10_000) / 100
      : null;

  const dayISOs = eachDayISO(from, to);
  const seriesDaily: PlatformTimePoint[] = dayISOs.map((iso) => {
    const msgs = channelHasData ? real.messagesDailySeries.get(iso) ?? 0 : 0;
    const usage = real.usageDailySeries.get(iso);
    const costIaBrl = Math.round((usage?.costUsd ?? 0) * real.usdToBrlRate * 100) / 100;
    return {
      dateISO: iso,
      messages: msgs,
      tokensIn: usage?.tokensIn ?? 0,
      tokensOut: usage?.tokensOut ?? 0,
      revenueBrl: real.revenueDailySeriesBrl.get(iso) ?? 0,
      costIaBrl,
      activeWorkspaces: workspacesActiveInPeriod,
    };
  });

  const peakDay = seriesDaily.reduce(
    (best, cur) => (cur.messages > (best?.messages ?? 0) ? cur : best),
    null as PlatformTimePoint | null,
  );

  const channelShare: PlatformChannelShare[] =
    channelHasData && totals.messages > 0
      ? [
          { channel: "whatsapp", messages: totals.messages, pct: 100 },
          { channel: "web", messages: 0, pct: 0 },
          { channel: "api", messages: 0, pct: 0 },
        ]
      : [
          { channel: "whatsapp", messages: 0, pct: 0 },
          { channel: "web", messages: 0, pct: 0 },
          { channel: "api", messages: 0, pct: 0 },
        ];

  const mrrApprox = Math.round((real.mrrCents / 100) * 100) / 100;
  const arrApprox = Math.round((real.arrCents / 100) * 100) / 100;

  return {
    workspaceDirectory: real.tenants.map((t) => ({ ref: t.id, label: `Workspace · ${t.id}` })),
    meta: {
      generatedAtISO: new Date().toISOString(),
      range: { fromISO: from.toISOString(), toISO: to.toISOString() },
      previousRange: { fromISO: prevFrom.toISOString(), toISO: prevTo.toISOString() },
      workspaceFilter: q.workspaceId,
      channel: q.channel,
      plan: q.plan,
      dataProvenance:
        "Dados reais: tenants/agentes/mensagens/sessões via Supabase; tokens e custo de IA via ai_usage_logs (preço real por modelo); MRR/ARR e receita via Stripe. Retenção e canais Web/API ainda sem fonte de dados — exibidos como indisponíveis em vez de estimados.",
    },
    kpis: {
      messagesProcessed: totals.messages,
      tokensConsumed: tokensTotal,
      interactions,
      workspacesRegistered,
      workspacesActiveInPeriod,
      agentsTotal,
      agentsActiveInPeriod,
      sessionsInPeriod: totals.sessions,
      avgMessagesPerWorkspace: avgMessages,
      avgTokensPerWorkspace: avgTokens,
      revenueTotalBrl: revenueTotal,
      costTotalBrl: costTotal,
      operatingMarginBrl: margin,
      growthVsPreviousPct,
    },
    consumption: {
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      avgDailyMessages: Math.round(totals.messages / days),
      avgWeeklyMessages: Math.round((totals.messages / days) * 7),
      avgMonthlyMessages: Math.round((totals.messages / days) * 30),
      peakDay: peakDay ? { dateISO: peakDay.dateISO, messages: peakDay.messages } : null,
      channelShare,
      seriesDaily,
    },
    operational: {
      agentsTotal,
      agentsInactive,
      integrationsActive: filtered.reduce((s, t) => s + (real.integrationsByTenant.get(t.id) ?? 0), 0),
      automationsExecuted: filtered.reduce((s, t) => s + (real.automationsByTenant.get(t.id) ?? 0), 0),
      sessionsTotal: totals.sessions,
      avgSessionDurationMin: workspaces.length
        ? Math.round((workspaces.reduce((s, w) => s + w.avgSessionDurationMin, 0) / workspaces.length) * 10) / 10
        : 0,
      retentionPct: null,
    },
    financial: {
      revenueTotalBrl: revenueTotal,
      revenuePreviousBrl: Math.round((real.revenuePreviousNetCents / 100) * 100) / 100,
      mrrApproxBrl: mrrApprox,
      arrApproxBrl: arrApprox,
      ticketMedioBrl: workspacesActiveInPeriod ? Math.round((mrrApprox / workspacesActiveInPeriod) * 100) / 100 : 0,
      costTotalBrl: costTotal,
      costPerMessageBrl: totals.messages ? Math.round((costTotal / totals.messages) * 1_000_000) / 1_000_000 : 0,
      costPerMillionTokensBrl: tokensTotal ? Math.round((costTotal / tokensTotal) * 1_000_000 * 100) / 100 : 0,
      operatingMarginBrl: margin,
      usdToBrlRate: real.usdToBrlRate,
    },
    workspaces: workspaces.sort((a, b) => b.messages - a.messages),
    analyticsExtras: real.analyticsExtras,
  };
}

export function parsePlatformMetricsQuery(searchParams: URLSearchParams): PlatformMetricsQuery {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 29 * MS_PER_DAY);
  const workspaceId = (searchParams.get("workspace") ?? "all") as "all" | string;
  const channel = (searchParams.get("channel") ?? "all") as PlatformChannel;
  const plan = (searchParams.get("plan") ?? "all") as PlatformPlanFilter;

  const validChannel: PlatformChannel = ["all", "whatsapp", "web", "api"].includes(channel) ? channel : "all";
  const validPlan: PlatformPlanFilter = ["all", "solo", "equipa", "escala", "enterprise"].includes(plan) ? plan : "all";

  return {
    from,
    to,
    workspaceId,
    channel: validChannel,
    plan: validPlan,
  };
}

export function canAccessPlatformMetricsApi(role: AdminRole): boolean {
  if (role === "super_admin") return true;
  const analyticsRoles: AdminRole[] = ["admin", "marketing"];
  const financeRoles: AdminRole[] = ["financeiro"];
  return analyticsRoles.includes(role) || financeRoles.includes(role);
}
