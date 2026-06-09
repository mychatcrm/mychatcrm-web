/**
 * Queries Supabase para o dashboard de overview.
 * Todas as queries filtram explicitamente por tenant_id (service client).
 * Nunca importar follow-up-jobs, agent-cta-scheduler ou Gateway aqui.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { OverviewStats } from "@/lib/dashboard-data";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type FetchOverviewStatsParams = {
  sb: ServiceClient;
  tenantId: string;
  fromISO: string; // YYYY-MM-DD
  toISO: string;   // YYYY-MM-DD
};

function toUTCStart(dateISO: string): string {
  return `${dateISO}T00:00:00.000Z`;
}
function toUTCEnd(dateISO: string): string {
  return `${dateISO}T23:59:59.999Z`;
}

/**
 * Busca todas as métricas do overview em paralelo.
 * Queries:
 *   Q1 — mensagens inbound + outbound (para charts + totais)
 *   Q2 — leads criados no período (para cards + gráfico de fonte/temperatura)
 *   Q3 — contagem de conversas ativas (snapshot)
 *   Q4 — contagem de conversas em handoff (snapshot)
 *   Q5 — contagem de conversas em automação (snapshot)
 *   Q6 — últimas 5 conversas ativas (para lista recente)
 *   Q7 — conversas arquivadas no período
 *   Q8 — agenda events no período
 *   Q9 — próximos 3 agendamentos (upcoming)
 *   Q10 — custo IA no período
 *   Q11 — follow-ups enviados no período
 */
export async function fetchOverviewStats(params: FetchOverviewStatsParams): Promise<OverviewStats> {
  const { sb, tenantId, fromISO, toISO } = params;
  const fromTs = toUTCStart(fromISO);
  const toTs = toUTCEnd(toISO);

  const [
    messagesRes,
    leadsRes,
    activeConvsCountRes,
    handoffCountRes,
    automationCountRes,
    recentConvsRes,
    closedConvsRes,
    agendaRes,
    upcomingAgendaRes,
    aiCostRes,
    followUpRes,
  ] = await Promise.all([
    // Q1: mensagens no período (limitado a 10k para performance)
    sb.from("whatsapp_messages")
      .select("created_at, direction")
      .eq("tenant_id", tenantId)
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at", { ascending: true })
      .limit(10000),

    // Q2: leads criados no período
    sb.from("leads")
      .select("id, status, lead_temperature, source")
      .eq("tenant_id", tenantId)
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .limit(5000),

    // Q3: total de conversas ativas (não arquivadas) — count only
    sb.from("conversation_states")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("archived_at", null),

    // Q4: conversas em handoff
    sb.from("conversation_states")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .in("conversation_mode", ["waiting_human", "human"]),

    // Q5: conversas em automação
    sb.from("conversation_states")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .eq("conversation_mode", "automation"),

    // Q6: últimas 5 conversas ativas (para lista recente)
    sb.from("conversation_states")
      .select("remote_jid, conversation_mode, updated_at")
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(5),

    // Q7: conversas arquivadas no período
    sb.from("conversation_states")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("archived_at", fromTs)
      .lte("archived_at", toTs),

    // Q8: agenda events no período
    sb.from("agenda_events")
      .select("status, start_at, title, attendee_name")
      .eq("tenant_id", tenantId)
      .gte("start_at", fromTs)
      .lte("start_at", toTs)
      .limit(200),

    // Q9: próximos 3 agendamentos (fora do range filtrado)
    sb.from("agenda_events")
      .select("title, start_at, attendee_name")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .gte("start_at", new Date().toISOString())
      .order("start_at", { ascending: true })
      .limit(3),

    // Q10: custo de IA no período
    sb.from("ai_usage_daily")
      .select("estimated_cost_usd")
      .eq("tenant_id", tenantId)
      .gte("day", fromISO)
      .lte("day", toISO),

    // Q11: follow-ups enviados no período
    sb.from("follow_up_jobs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "sent")
      .gte("updated_at", fromTs)
      .lte("updated_at", toTs),
  ]);

  // --- processar mensagens ---
  const messages = messagesRes.data ?? [];
  const dayBuckets: Record<string, { inbound: number; outbound: number }> = {};
  const hourBuckets: Record<number, number> = {};

  for (const msg of messages) {
    const day = (msg.created_at as string).slice(0, 10);
    if (!dayBuckets[day]) dayBuckets[day] = { inbound: 0, outbound: 0 };
    if (msg.direction === "inbound") {
      dayBuckets[day].inbound++;
    } else {
      dayBuckets[day].outbound++;
    }
    const hour = new Date(msg.created_at as string).getHours();
    hourBuckets[hour] = (hourBuckets[hour] ?? 0) + 1;
  }

  const totalMessages = messages.length;
  const messagesByDay = Object.entries(dayBuckets)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const peakHourCounts = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: hourBuckets[h] ?? 0,
  }));
  const peakHourEntry = peakHourCounts.reduce<{ hour: number; count: number } | null>((best, cur) =>
    cur.count > (best?.count ?? 0) ? cur : best, null
  );
  const peakHour = (peakHourEntry && peakHourEntry.count > 0) ? peakHourEntry.hour : null;

  // --- processar leads ---
  const leads = leadsRes.data ?? [];
  const newLeads = leads.length;
  const leadsInOpportunity = leads.filter(
    (l) => l.status && l.status !== "novo"
  ).length;

  const sourceBuckets: Record<string, number> = {};
  const tempBuckets: Record<string, number> = {};
  for (const lead of leads) {
    const src = (lead.source as string | null) ?? "manual";
    sourceBuckets[src] = (sourceBuckets[src] ?? 0) + 1;
    if (lead.lead_temperature) {
      const t = lead.lead_temperature as string;
      tempBuckets[t] = (tempBuckets[t] ?? 0) + 1;
    }
  }
  const leadsBySource = Object.entries(sourceBuckets)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  const leadsByTemperature = Object.entries(tempBuckets)
    .map(([temperature, count]) => ({ temperature, count }));

  // --- processar conversas ---
  const totalActiveConvs = activeConvsCountRes.count ?? 0;
  const handoffCount = handoffCountRes.count ?? 0;
  const automationConvs = automationCountRes.count ?? 0;
  const automationRate =
    totalActiveConvs > 0 ? Math.round((automationConvs / totalActiveConvs) * 100) : 0;
  const closedConversations = closedConvsRes.count ?? 0;

  const recentConversations = (recentConvsRes.data ?? []).map((s) => ({
    phone: (s.remote_jid as string).split("@")[0] ?? (s.remote_jid as string),
    name: null as string | null,
    mode: (s.conversation_mode as string) ?? "automation",
    lastAt: s.updated_at as string,
  }));

  // --- processar agenda ---
  const agendaEvents = agendaRes.data ?? [];
  const agendaConfirmed = agendaEvents.filter((e) => e.status !== "cancelled").length;
  const agendaCancelled = agendaEvents.filter((e) => e.status === "cancelled").length;

  const upcomingAgenda = (upcomingAgendaRes.data ?? []).map((e) => ({
    title: (e.title as string) ?? "Agendamento",
    startAt: e.start_at as string,
    attendeeName: (e.attendee_name as string | null) ?? null,
  }));

  // --- processar IA ---
  const aiCostUsd = (aiCostRes.data ?? []).reduce(
    (sum, row) => sum + ((row.estimated_cost_usd as number | null) ?? 0),
    0
  );

  // --- processar follow-up ---
  const followUpSent = followUpRes.count ?? 0;

  return {
    period: { fromISO, toISO },
    totalMessages,
    newLeads,
    closedConversations,
    activeConversations: totalActiveConvs,
    handoffCount,
    automationRate,
    peakHour,
    leadsInOpportunity,
    agendaConfirmed,
    agendaCancelled,
    followUpSent,
    aiCostUsd,
    messagesByDay,
    peakHourCounts,
    leadsBySource,
    leadsByTemperature,
    recentConversations,
    upcomingAgenda,
  };
}
