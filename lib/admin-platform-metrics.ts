/**
 * Métricas agregadas da plataforma para o painel administrativo `/admin`.
 *
 * FONTE DE DADOS (hoje): apenas campos quantitativos já expostos em `AdminClientRow`
 * (MRR, agentes, uso de cota, plano, estado) — sem conversas, mensagens reais nem PII.
 * Os volumes de mensagens/tokens/sessões são *estimativas determinísticas* derivadas desses
 * sinais, até existir pipeline de telemetria (warehouse / billing usage).
 *
 * Privacidade: identificação por `workspaceRef` (id interno). Não expor nomes de empresas
 * nem e-mails neste payload.
 */

import type { AdminRole } from "@/lib/admin-auth";
import type { AdminClientRow } from "@/lib/admin-data";

/** Custo estimado de inferência (não faturamento Meta); ajustável quando houver custo real por token. */
export const PLATFORM_ESTIMATED_COST_BRL_PER_MILLION_TOKENS = 18;

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;

export type PlatformChannel = "all" | "whatsapp" | "web" | "api";

export type PlatformPlanFilter = "all" | "Profissional" | "Master";

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
  screenMinutes: number;
  agentsConfigured: number;
  revenueBrl: number;
  costIaBrl: number;
  marginBrl: number;
  plan: AdminClientRow["plano"];
  status: AdminClientRow["status"];
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
  screenMinutesTotal: number;
  avgScreenMinutesPerWorkspace: number;
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
  costIaEstimateBrl: number;
  callsByAgentEstimate: number;
  callsByWorkspaceEstimate: number;
  avgDailyMessages: number;
  avgWeeklyMessages: number;
  avgMonthlyMessages: number;
  peakDay: { dateISO: string; messages: number } | null;
  channelShare: PlatformChannelShare[];
  seriesDaily: PlatformTimePoint[];
};

export type PlatformOperationalBlock = {
  agentsTotal: number;
  agentsInactiveEstimate: number;
  integrationsHitsEstimate: number;
  automationsEstimate: number;
  sessionsTotal: number;
  avgSessionMinutes: number;
  channelUsage: PlatformChannelShare[];
  retentionPctEstimate: number;
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
};

export type WorkspaceDirectoryEntry = { ref: string; label: string };

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
};

export function stableHash32(input: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

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

/** Fração de tráfego atribuída a cada canal (modelo agregado; calibrar com telemetria real). */
function trafficFractionForChannel(channel: PlatformChannel): number {
  if (channel === "all") return 1;
  const base: Record<Exclude<PlatformChannel, "all">, number> = { whatsapp: 0.64, web: 0.22, api: 0.14 };
  return base[channel];
}

function workspaceMonthlyEstimates(row: Pick<AdminClientRow, "id" | "mrr" | "status" | "agentesAtivos" | "plano" | "monthlyLeadUsagePct">) {
  const h = stableHash32(row.id);
  const monthlyMessages = Math.round(
    6_000 + row.monthlyLeadUsagePct * 520 + row.agentesAtivos * 11_000 + (h % 9_000),
  );
  const monthlyTokensIn = Math.round(monthlyMessages * 165 + (h % 400_000));
  const monthlyTokensOut = Math.round(monthlyMessages * 410 + (h % 700_000));
  const monthlySessions = Math.round(120 + row.monthlyLeadUsagePct * 6 + row.agentesAtivos * 45 + (h % 90));
  const monthlyScreenMinutes = Math.round(monthlySessions * 22 + (h % 3_000));
  const monthlyIntegrationHits = Math.round(row.agentesAtivos * 3_800 + (h % 18_000));
  const monthlyAutomations = Math.round(row.agentesAtivos * 1_200 + row.monthlyLeadUsagePct * 40 + (h % 6_000));
  return {
    monthlyMessages,
    monthlyTokensIn,
    monthlyTokensOut,
    monthlySessions,
    monthlyScreenMinutes,
    monthlyIntegrationHits,
    monthlyAutomations,
  };
}

function filterClients(clients: AdminClientRow[], q: PlatformMetricsQuery): AdminClientRow[] {
  return clients.filter((c) => {
    if (q.workspaceId !== "all" && c.id !== q.workspaceId) return false;
    if (q.plan !== "all" && c.plano !== q.plan) return false;
    return true;
  });
}

function scaleForPeriod(monthly: number, days: number): number {
  return Math.round((monthly * days) / 30);
}

function sumWorkspaceRows(
  rows: WorkspaceAggregateRow[],
): Pick<
  WorkspaceAggregateRow,
  "messages" | "tokensIn" | "tokensOut" | "sessions" | "screenMinutes" | "revenueBrl" | "costIaBrl"
> {
  return rows.reduce(
    (acc, r) => ({
      messages: acc.messages + r.messages,
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      sessions: acc.sessions + r.sessions,
      screenMinutes: acc.screenMinutes + r.screenMinutes,
      revenueBrl: acc.revenueBrl + r.revenueBrl,
      costIaBrl: acc.costIaBrl + r.costIaBrl,
    }),
    { messages: 0, tokensIn: 0, tokensOut: 0, sessions: 0, screenMinutes: 0, revenueBrl: 0, costIaBrl: 0 },
  );
}

export function computePlatformMetrics(clients: AdminClientRow[], rawQuery: PlatformMetricsQuery): PlatformMetricsPayload {
  const { from, to } = clampRange(rawQuery.from, rawQuery.to);
  const q: PlatformMetricsQuery = { ...rawQuery, from, to };
  const days = Math.max(1, inclusiveDayCount(from, to));
  const prevTo = new Date(from.getTime() - MS_PER_DAY);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * MS_PER_DAY);

  const filtered = filterClients(clients, q);
  const trafficFrac = trafficFractionForChannel(q.channel);

  const rows: WorkspaceAggregateRow[] = filtered.map((c) => {
    const est = workspaceMonthlyEstimates(c);
    const msgs = scaleForPeriod(est.monthlyMessages, days);
    const tIn = scaleForPeriod(est.monthlyTokensIn, days);
    const tOut = scaleForPeriod(est.monthlyTokensOut, days);
    const sess = scaleForPeriod(est.monthlySessions, days);
    const scr = scaleForPeriod(est.monthlyScreenMinutes, days);
    const rev = (c.mrr * days) / 30;
    const tokens = tIn + tOut;
    const costIa = (tokens / 1_000_000) * PLATFORM_ESTIMATED_COST_BRL_PER_MILLION_TOKENS;
    return {
      workspaceRef: c.id,
      label: `Workspace · ${c.id}`,
      messages: msgs,
      tokensIn: tIn,
      tokensOut: tOut,
      sessions: sess,
      screenMinutes: scr,
      agentsConfigured: c.agentesAtivos,
      revenueBrl: Math.round(rev * 100) / 100,
      costIaBrl: Math.round(costIa * 100) / 100,
      marginBrl: Math.round((rev - costIa) * 100) / 100,
      plan: c.plano,
      status: c.status,
    };
  });

  const totals = sumWorkspaceRows(rows);
  const messagesScaled = Math.round(totals.messages * trafficFrac);
  const tokensScaled = Math.round((totals.tokensIn + totals.tokensOut) * trafficFrac);

  const tokensInScaled = Math.round(totals.tokensIn * trafficFrac);
  const tokensOutScaled = Math.round(totals.tokensOut * trafficFrac);

  const workspacesRegistered = filtered.length;
  const workspacesActiveInPeriod = filtered.filter((c) => c.status === "ativo" || c.status === "inadimplente" || c.status === "trial").length;
  const agentsTotal = filtered.reduce((s, c) => s + c.agentesAtivos, 0);
  const agentsActiveInPeriod = Math.round(agentsTotal * (0.82 + (days / 120) * 0.05));

  const costIaEstimate = (tokensScaled / 1_000_000) * PLATFORM_ESTIMATED_COST_BRL_PER_MILLION_TOKENS;
  const interactions = Math.round(
    messagesScaled +
      filtered.reduce((s, c) => s + scaleForPeriod(workspaceMonthlyEstimates(c).monthlyIntegrationHits, days), 0) *
        trafficFrac,
  );

  const revenueTotal = Math.round(totals.revenueBrl * 100) / 100;
  const costTotal = Math.round(costIaEstimate * 100) / 100;
  const margin = Math.round((revenueTotal - costTotal) * 100) / 100;

  const avgMessages = workspacesRegistered ? Math.round(messagesScaled / workspacesRegistered) : 0;
  const avgTokens = workspacesRegistered ? Math.round(tokensScaled / workspacesRegistered) : 0;
  const avgScreen = workspacesRegistered ? Math.round(totals.screenMinutes / workspacesRegistered) : 0;

  const prevFiltered = filterClients(clients, { ...q, from: prevFrom, to: prevTo });
  const prevRows: WorkspaceAggregateRow[] = prevFiltered.map((c) => {
    const est = workspaceMonthlyEstimates(c);
    const msgs = scaleForPeriod(est.monthlyMessages, days);
    const tIn = scaleForPeriod(est.monthlyTokensIn, days);
    const tOut = scaleForPeriod(est.monthlyTokensOut, days);
    const sess = scaleForPeriod(est.monthlySessions, days);
    const scr = scaleForPeriod(est.monthlyScreenMinutes, days);
    const rev = (c.mrr * days) / 30;
    const tokens = tIn + tOut;
    const costIa = (tokens / 1_000_000) * PLATFORM_ESTIMATED_COST_BRL_PER_MILLION_TOKENS;
    return {
      workspaceRef: c.id,
      label: `Workspace · ${c.id}`,
      messages: msgs,
      tokensIn: tIn,
      tokensOut: tOut,
      sessions: sess,
      screenMinutes: scr,
      agentsConfigured: c.agentesAtivos,
      revenueBrl: Math.round(rev * 100) / 100,
      costIaBrl: Math.round(costIa * 100) / 100,
      marginBrl: Math.round((rev - costIa) * 100) / 100,
      plan: c.plano,
      status: c.status,
    };
  });
  const prevTotals = sumWorkspaceRows(prevRows);
  const prevMessages = Math.round(prevTotals.messages * trafficFrac);
  const growthVsPreviousPct =
    prevMessages > 0 ? Math.round(((messagesScaled - prevMessages) / prevMessages) * 10_000) / 100 : null;

  const dayISOs = eachDayISO(from, to);
  const seriesDaily: PlatformTimePoint[] = dayISOs.map((iso, idx) => {
    const wave = 0.85 + 0.15 * Math.sin((idx / Math.max(1, dayISOs.length)) * Math.PI * 2);
    const noise = 0.92 + (stableHash32(`${iso}:${q.workspaceId}:${q.channel}`) % 160) / 1000;
    const share = messagesScaled / Math.max(1, dayISOs.length);
    const dayMsgs = Math.max(0, Math.round(share * wave * noise));
    const dayTokens = Math.round((tokensScaled / Math.max(1, dayISOs.length)) * wave * noise);
    const splitIn = 0.28;
    const dayRev = revenueTotal / Math.max(1, dayISOs.length);
    const dayCost = (dayTokens / 1_000_000) * PLATFORM_ESTIMATED_COST_BRL_PER_MILLION_TOKENS;
    return {
      dateISO: iso,
      messages: dayMsgs,
      tokensIn: Math.round(dayTokens * splitIn),
      tokensOut: Math.round(dayTokens * (1 - splitIn)),
      revenueBrl: Math.round(dayRev * 100) / 100,
      costIaBrl: Math.round(dayCost * 100) / 100,
      activeWorkspaces: workspacesActiveInPeriod,
    };
  });

  const peakDay = seriesDaily.reduce(
    (best, cur) => (cur.messages > (best?.messages ?? 0) ? cur : best),
    null as PlatformTimePoint | null,
  );

  const baseW = { whatsapp: 0.64, web: 0.22, api: 0.14 };
  const rawShare =
    q.channel === "all"
      ? {
          whatsapp: Math.round(totals.messages * baseW.whatsapp),
          web: Math.round(totals.messages * baseW.web),
          api: Math.round(totals.messages * baseW.api),
        }
      : {
          whatsapp: q.channel === "whatsapp" ? messagesScaled : 0,
          web: q.channel === "web" ? messagesScaled : 0,
          api: q.channel === "api" ? messagesScaled : 0,
        };
  const shareTotal = rawShare.whatsapp + rawShare.web + rawShare.api || 1;
  const channelShare: PlatformChannelShare[] = [
    { channel: "whatsapp", messages: rawShare.whatsapp, pct: Math.round((rawShare.whatsapp / shareTotal) * 1000) / 10 },
    { channel: "web", messages: rawShare.web, pct: Math.round((rawShare.web / shareTotal) * 1000) / 10 },
    { channel: "api", messages: rawShare.api, pct: Math.round((rawShare.api / shareTotal) * 1000) / 10 },
  ];

  const mrrApprox = workspacesRegistered ? revenueTotal / (days / 30) : 0;
  const arrApprox = mrrApprox * 12;

  return {
    workspaceDirectory: clients.map((c) => ({ ref: c.id, label: `Workspace · ${c.id}` })),
    meta: {
      generatedAtISO: new Date().toISOString(),
      range: { fromISO: from.toISOString(), toISO: to.toISOString() },
      previousRange: { fromISO: prevFrom.toISOString(), toISO: prevTo.toISOString() },
      workspaceFilter: q.workspaceId,
      channel: q.channel,
      plan: q.plan,
      dataProvenance:
        "Métricas derivadas de sinais administrativos (MRR, agentes, quotas) com distribuição temporal determinística. Não inclui conteúdo de conversas nem dados pessoais. Substituir por agregações de warehouse em produção.",
    },
    kpis: {
      messagesProcessed: messagesScaled,
      tokensConsumed: tokensScaled,
      interactions,
      workspacesRegistered,
      workspacesActiveInPeriod,
      agentsTotal,
      agentsActiveInPeriod,
      sessionsInPeriod: totals.sessions,
      screenMinutesTotal: totals.screenMinutes,
      avgScreenMinutesPerWorkspace: avgScreen,
      avgMessagesPerWorkspace: avgMessages,
      avgTokensPerWorkspace: avgTokens,
      revenueTotalBrl: revenueTotal,
      costTotalBrl: costTotal,
      operatingMarginBrl: margin,
      growthVsPreviousPct,
    },
    consumption: {
      tokensIn: tokensInScaled,
      tokensOut: tokensOutScaled,
      costIaEstimateBrl: costTotal,
      callsByAgentEstimate: Math.round(agentsTotal * 420 * (days / 30)),
      callsByWorkspaceEstimate: Math.round(workspacesRegistered * 1800 * (days / 30)),
      avgDailyMessages: Math.round(messagesScaled / days),
      avgWeeklyMessages: Math.round((messagesScaled / days) * 7),
      avgMonthlyMessages: Math.round((messagesScaled / days) * 30),
      peakDay: peakDay ? { dateISO: peakDay.dateISO, messages: peakDay.messages } : null,
      channelShare,
      seriesDaily,
    },
    operational: {
      agentsTotal,
      agentsInactiveEstimate: Math.max(0, agentsTotal - agentsActiveInPeriod),
      integrationsHitsEstimate: Math.round(
        filtered.reduce((s, c) => s + scaleForPeriod(workspaceMonthlyEstimates(c).monthlyIntegrationHits, days), 0) *
          trafficFrac,
      ),
      automationsEstimate: Math.round(
        filtered.reduce((s, c) => s + scaleForPeriod(workspaceMonthlyEstimates(c).monthlyAutomations, days), 0) *
          trafficFrac,
      ),
      sessionsTotal: totals.sessions,
      avgSessionMinutes: totals.sessions ? Math.round(totals.screenMinutes / totals.sessions) : 0,
      channelUsage: channelShare,
      retentionPctEstimate: Math.min(98, 68 + Math.round((workspacesActiveInPeriod / Math.max(1, workspacesRegistered)) * 22)),
    },
    financial: {
      revenueTotalBrl: revenueTotal,
      revenuePreviousBrl: Math.round(prevTotals.revenueBrl * 100) / 100,
      mrrApproxBrl: Math.round(mrrApprox * 100) / 100,
      arrApproxBrl: Math.round(arrApprox * 100) / 100,
      ticketMedioBrl: workspacesRegistered ? Math.round((revenueTotal / workspacesRegistered) * 100) / 100 : 0,
      costTotalBrl: costTotal,
      costPerMessageBrl: messagesScaled ? Math.round((costTotal / messagesScaled) * 1_000_000) / 1_000_000 : 0,
      costPerMillionTokensBrl: tokensScaled ? Math.round((costTotal / tokensScaled) * 1_000_000 * 100) / 100 : 0,
      operatingMarginBrl: margin,
    },
    workspaces: rows.sort((a, b) => b.messages - a.messages),
  };
}

export function parsePlatformMetricsQuery(searchParams: URLSearchParams, defaultClients: AdminClientRow[]): PlatformMetricsQuery {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 29 * MS_PER_DAY);
  const workspaceId = (searchParams.get("workspace") ?? "all") as "all" | string;
  const channel = (searchParams.get("channel") ?? "all") as PlatformChannel;
  const plan = (searchParams.get("plan") ?? "all") as PlatformPlanFilter;

  const validChannel: PlatformChannel = ["all", "whatsapp", "web", "api"].includes(channel) ? channel : "all";
  const validPlan: PlatformPlanFilter = ["all", "Profissional", "Master"].includes(plan) ? plan : "all";
  const validWorkspace =
    workspaceId === "all" || defaultClients.some((c) => c.id === workspaceId) ? workspaceId : "all";

  return {
    from,
    to,
    workspaceId: validWorkspace,
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
