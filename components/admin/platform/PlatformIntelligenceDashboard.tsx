"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminSession } from "@/lib/admin-auth";
import {
  canAccessPlatformMetricsApi,
  type PlatformChannel,
  type PlatformMetricsPayload,
  type PlatformPlanFilter,
} from "@/lib/admin-platform-metrics";
import { formatIntegerPtBr } from "@/lib/format-number";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { cn, formatBRL, formatCompactNumber } from "@/lib/utils";
import { typography } from "@/lib/typography";

const MS_DAY = 86_400_000;

type PresetId = "today" | "7d" | "30d" | "this_month" | "last_month" | "custom";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeFromPreset(preset: PresetId): { from: Date; to: Date } {
  const end = startOfDay(new Date());
  if (preset === "today") {
    return { from: end, to: end };
  }
  if (preset === "7d") {
    return { from: new Date(end.getTime() - 6 * MS_DAY), to: end };
  }
  if (preset === "30d") {
    return { from: new Date(end.getTime() - 29 * MS_DAY), to: end };
  }
  if (preset === "this_month") {
    const from = new Date(end.getFullYear(), end.getMonth(), 1);
    return { from: startOfDay(from), to: end };
  }
  if (preset === "last_month") {
    const firstThis = new Date(end.getFullYear(), end.getMonth(), 1);
    const lastPrev = new Date(firstThis.getTime() - MS_DAY);
    const from = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
    return { from: startOfDay(from), to: startOfDay(lastPrev) };
  }
  return { from: new Date(end.getTime() - 29 * MS_DAY), to: end };
}

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "default" | "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-card p-4",
        accent === "success" && "border-emerald-500/25 bg-emerald-500/[0.06]",
        accent === "warning" && "border-amber-500/25 bg-amber-500/[0.06]",
      )}
    >
      <p className={cn(typography.ui.overline)}>{label}</p>
      <p className="mt-2 font-display text-xl font-bold tabular-nums tracking-tight text-content sm:text-2xl">{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-content-faint">{hint}</p> : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-lg font-semibold text-content">{title}</h2>
        {description ? <p className="mt-1 text-sm text-content-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

const CHART_COLORS = ["#F24400", "#0E1D29", "#B22A00", "#00A650", "#71717A"];

export function PlatformIntelligenceDashboard({ session }: { session: AdminSession }) {
  const allowed = useMemo(() => canAccessPlatformMetricsApi(session.role), [session.role]);
  const [preset, setPreset] = useState<PresetId>("30d");
  const initialRange = useMemo(() => rangeFromPreset("30d"), []);
  const [fromYmd, setFromYmd] = useState(() => formatYmd(initialRange.from));
  const [toYmd, setToYmd] = useState(() => formatYmd(initialRange.to));
  const [workspaceId, setWorkspaceId] = useState<"all" | string>("all");
  const [channel, setChannel] = useState<PlatformChannel>("all");
  const [plan, setPlan] = useState<PlatformPlanFilter>("all");
  const [data, setData] = useState<PlatformMetricsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preset === "custom") return;
    const { from, to } = rangeFromPreset(preset);
    setFromYmd(formatYmd(from));
    setToYmd(formatYmd(to));
  }, [preset]);

  const fetchMetrics = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      const fallback = rangeFromPreset("30d");
      qs.set("from", fromYmd || formatYmd(fallback.from));
      qs.set("to", toYmd || formatYmd(fallback.to));
      qs.set("workspace", workspaceId);
      qs.set("channel", channel);
      qs.set("plan", plan);
      const res = await fetch(`/api/admin/platform-metrics?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as PlatformMetricsPayload | { error?: string } | null;
      if (!res.ok) {
        setData(null);
        setError((json && "error" in json && json.error) || "Falha ao carregar métricas.");
        return;
      }
      if (!json || typeof json !== "object" || !("kpis" in json)) {
        setData(null);
        setError("Resposta inválida.");
        return;
      }
      setData(json as PlatformMetricsPayload);
    } catch {
      setData(null);
      setError("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [allowed, fromYmd, toYmd, workspaceId, channel, plan]);

  useEffect(() => {
    if (!allowed) return;
    if (!fromYmd || !toYmd) return;
    void fetchMetrics();
  }, [allowed, fetchMetrics, fromYmd, toYmd, workspaceId, channel, plan]);

  if (!allowed) {
    return (
      <div className="rounded-xl border border-line bg-surface-card p-8 text-center">
        <p className="font-medium text-content">Acesso restrito</p>
        <p className="mt-2 text-sm text-content-muted">
          O seu papel administrativo não inclui a leitura de métricas consolidadas da plataforma. Contacte um super
          admin se precisar deste acesso.
        </p>
      </div>
    );
  }

  const pieData =
    data?.consumption.channelShare
      .filter((c) => c.messages > 0)
      .map((c) => ({
        name: c.channel === "whatsapp" ? "WhatsApp" : c.channel === "web" ? "Web" : "API",
        value: c.messages,
      })) ?? [];
  const pieTotal = pieData.reduce((s, x) => s + x.value, 0);

  const financeCompare =
    data?.consumption.seriesDaily.map((d) => ({
      date: d.dateISO.slice(5),
      receita: d.revenueBrl,
      custoIA: d.costIaBrl,
    })) ?? [];

  const tokenSeries =
    data?.consumption.seriesDaily.map((d) => ({
      date: d.dateISO.slice(5),
      entrada: d.tokensIn / 1_000_000,
      saida: d.tokensOut / 1_000_000,
    })) ?? [];

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-sm text-content-secondary sm:px-5">
        <strong className="text-content">Privacidade:</strong> esta visão mostra apenas agregados administrativos e
        identificadores internos de workspace. Não são exibidos conteúdos de conversas, mensagens, contactos finais nem
        dados pessoais. Os volumes de uso são estimados a partir de sinais operacionais até existir pipeline de
        telemetria em produção.
      </div>

      <Section
        title="Filtros"
        description="Atualizam KPIs, gráficos e tabelas. Intervalo máximo de 366 dias."
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["today", "Hoje"],
              ["7d", "7 dias"],
              ["30d", "30 dias"],
              ["this_month", "Este mês"],
              ["last_month", "Mês passado"],
              ["custom", "Personalizado"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPreset(id)}
              className={cn(
                "min-h-[40px] rounded-xl border px-3 text-xs font-semibold transition sm:text-sm",
                preset === id
                  ? "border-primary/50 bg-primary/15 text-content"
                  : "border-line bg-surface-elevated/40 text-content-secondary hover:border-primary/30",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div>
            <label className="text-xs font-medium text-content-muted">De</label>
            <Input
              type="date"
              className="mt-1"
              value={fromYmd}
              onChange={(e) => {
                setPreset("custom");
                setFromYmd(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-content-muted">Até</label>
            <Input
              type="date"
              className="mt-1"
              value={toYmd}
              onChange={(e) => {
                setPreset("custom");
                setToYmd(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-content-muted">Workspace</label>
            <Select
              className="mt-1"
              value={workspaceId}
              onChange={(e) => setWorkspaceId((e.target.value as "all" | string) || "all")}
            >
              <option value="all">Todos os workspaces</option>
              {(data?.workspaceDirectory ?? []).map((w) => (
                <option key={w.ref} value={w.ref}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-content-muted">Canal</label>
            <Select className="mt-1" value={channel} onChange={(e) => setChannel(e.target.value as PlatformChannel)}>
              <option value="all">Todos</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="web">Web</option>
              <option value="api">API</option>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-content-muted">Plano (workspace)</label>
            <Select className="mt-1" value={plan} onChange={(e) => setPlan(e.target.value as PlatformPlanFilter)}>
              <option value="all">Todos</option>
              <option value="solo">Solo</option>
              <option value="equipa">Equipa</option>
              <option value="escala">Escala</option>
              <option value="enterprise">Enterprise</option>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="secondary" className="w-full" isLoading={loading} onClick={() => void fetchMetrics()}>
              Atualizar
            </Button>
          </div>
        </div>
      </Section>

      {error ? (
        <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      ) : null}

      {!data && !loading && !error ? (
        <p className="text-sm text-content-muted">A carregar…</p>
      ) : null}

      {data ? (
        <>
          <p className="text-xs text-content-faint">{data.meta.dataProvenance}</p>

          <Section title="KPIs principais" description="Visão consolidada da plataforma no intervalo selecionado.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              <Kpi label="Mensagens processadas" value={formatIntegerPtBr(data.kpis.messagesProcessed)} hint="WhatsApp — único canal com tracking real hoje" />
              <Kpi label="Tokens consumidos" value={formatCompactNumber(data.kpis.tokensConsumed)} hint="Input + output, somados de ai_usage_logs" />
              <Kpi label="Interações / execuções" value={formatIntegerPtBr(data.kpis.interactions)} hint="Chamadas de IA registadas no período" />
              <Kpi label="Workspaces registados" value={formatIntegerPtBr(data.kpis.workspacesRegistered)} hint="Contas na base administrativa" />
              <Kpi label="Workspaces ativos (período)" value={formatIntegerPtBr(data.kpis.workspacesActiveInPeriod)} />
              <Kpi label="Agentes (configurados)" value={formatIntegerPtBr(data.kpis.agentsTotal)} />
              <Kpi label="Agentes ativos no período" value={formatIntegerPtBr(data.kpis.agentsActiveInPeriod)} hint="Com pelo menos 1 chamada de IA no período" />
              <Kpi label="Sessões (período)" value={formatIntegerPtBr(data.kpis.sessionsInPeriod)} />
              <Kpi label="Média msgs / workspace" value={formatIntegerPtBr(data.kpis.avgMessagesPerWorkspace)} />
              <Kpi label="Média tokens / workspace" value={formatCompactNumber(data.kpis.avgTokensPerWorkspace)} />
              <Kpi label="Receita (período)" value={formatBRL(data.kpis.revenueTotalBrl)} accent="success" hint="Charges Stripe líquidos de reembolso" />
              <Kpi
                label="Custo IA"
                value={formatBRL(data.kpis.costTotalBrl)}
                hint={`Real (ai_usage_logs) · câmbio 1 USD = R$ ${data.financial.usdToBrlRate.toFixed(2)}`}
              />
              <Kpi label="Saldo operacional" value={formatBRL(data.kpis.operatingMarginBrl)} accent={data.kpis.operatingMarginBrl >= 0 ? "success" : "warning"} />
              <Kpi
                label="Crescimento vs período anterior"
                value={data.kpis.growthVsPreviousPct == null ? "—" : `${data.kpis.growthVsPreviousPct} %`}
                hint="Mensagens agregadas (mesmo n.º de dias)"
              />
            </div>
          </Section>

          <Section
            title="Consumo global"
            description="Séries diárias, picos e distribuição por canal (modelo agregado — sem conteúdo de mensagens)."
          >
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="h-[280px] min-h-[240px] w-full min-w-0">
                <p className="mb-2 text-xs font-medium text-content-muted">Mensagens por dia</p>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.consumption.seriesDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="dateISO" tick={{ fontSize: 11 }} tickFormatter={(v) => String(v).slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} width={44} />
                    <Tooltip
                      contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, color: "#09090B" }}
                      labelStyle={{ color: "#09090B" }}
                    />
                    <Line type="monotone" dataKey="messages" name="Mensagens" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-[280px] min-h-[240px] w-full min-w-0">
                <p className="mb-2 text-xs font-medium text-content-muted">Tokens (M) — entrada vs saída</p>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={tokenSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={44} />
                    <Tooltip
                      contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, color: "#09090B" }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="entrada" name="Input (M)" stackId="1" stroke={CHART_COLORS[1]} fill={`${CHART_COLORS[1]}55`} />
                    <Area type="monotone" dataKey="saida" name="Output (M)" stackId="1" stroke={CHART_COLORS[2]} fill={`${CHART_COLORS[2]}55`} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Tokens input" value={formatCompactNumber(data.consumption.tokensIn)} />
              <Kpi label="Tokens output" value={formatCompactNumber(data.consumption.tokensOut)} />
              <Kpi label="Média diária (msgs)" value={formatIntegerPtBr(data.consumption.avgDailyMessages)} />
              <Kpi label="Pico (dia)" value={data.consumption.peakDay ? `${data.consumption.peakDay.dateISO}` : "—"} hint={data.consumption.peakDay ? `${formatIntegerPtBr(data.consumption.peakDay.messages)} msgs` : undefined} />
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="h-[260px] min-h-[220px] w-full min-w-0">
                <p className="mb-2 text-xs font-medium text-content-muted">Distribuição por canal (mensagens)</p>
                <p className="mb-2 text-[11px] text-content-faint">Apenas WhatsApp tem rastreamento real hoje.</p>
                {pieTotal > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={88}
                        paddingAngle={2}
                      >
                        {pieData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "#FFFFFF",
                          border: "1px solid #E2E8F0",
                          color: "#09090B",
                          borderRadius: 12,
                        }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-16 text-center text-sm text-content-muted">Sem volume para o canal filtrado.</p>
                )}
              </div>
              <div className="h-[260px] min-h-[220px] w-full min-w-0">
                <p className="mb-2 text-xs font-medium text-content-muted">Consumo por workspace (mensagens)</p>
                {data.workspaces.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.workspaces} layout="vertical" margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{
                          background: "#FFFFFF",
                          border: "1px solid #E2E8F0",
                          color: "#09090B",
                          borderRadius: 12,
                        }}
                      />
                      <Bar dataKey="messages" name="Mensagens" fill={CHART_COLORS[0]} radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-16 text-center text-sm text-content-muted">Sem workspaces no filtro.</p>
                )}
              </div>
            </div>
          </Section>

          <Section title="Indicadores operacionais" description="Capacidade, sessões e retenção (sem logs sensíveis).">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi label="Integrações ativas" value={formatIntegerPtBr(data.operational.integrationsActive)} hint="Conexões WhatsApp com status 'open'" />
              <Kpi label="Automações executadas" value={formatIntegerPtBr(data.operational.automationsExecuted)} hint="Eventos de follow-up no período" />
              <Kpi label="Agentes inativos" value={formatIntegerPtBr(data.operational.agentsInactive)} hint="tenant_agents.active = false" />
              <Kpi label="Duração média de conversa (min)" value={formatIntegerPtBr(data.operational.avgSessionDurationMin)} hint="last_message_at − created_at" />
              <Kpi
                label="Retenção"
                value={data.operational.retentionPct == null ? "—" : `${data.operational.retentionPct}%`}
                hint="Sem histórico de cohort suficiente ainda"
              />
            </div>
          </Section>

          <Section title="Indicadores financeiros" description="Receita derivada de MRR administrativo; custos de IA estimados por token.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="MRR aproximado" value={formatBRL(data.financial.mrrApproxBrl)} />
              <Kpi label="ARR aproximado" value={formatBRL(data.financial.arrApproxBrl)} />
              <Kpi label="Ticket médio / workspace" value={formatBRL(data.financial.ticketMedioBrl)} />
              <Kpi label="Receita período anterior" value={formatBRL(data.financial.revenuePreviousBrl)} />
              <Kpi label="Custo / mensagem" value={formatBRL(data.financial.costPerMessageBrl)} />
              <Kpi label="Custo / milhão tokens" value={formatBRL(data.financial.costPerMillionTokensBrl)} />
            </div>
            <div className="mt-6 h-[300px] min-h-[260px] w-full min-w-0">
              <p className="mb-2 text-xs font-medium text-content-muted">Receita vs custo IA (diário)</p>
              {financeCompare.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={financeCompare} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip
                      contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, color: "#09090B" }}
                    />
                    <Legend />
                    <Bar dataKey="receita" name="Receita" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="custoIA" name="Custo IA" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-content-muted">Sem série para o intervalo.</p>
              )}
            </div>
          </Section>

          <Section
            title="Detalhe por workspace (quantitativo)"
            description="Somente métricas agregadas por conta interna — sem nomes comerciais nem contactos."
          >
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="min-w-[720px] w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-elevated/40 text-left text-xs uppercase tracking-wide text-content-muted">
                    <th className="px-4 py-3">Workspace</th>
                    <th className="px-4 py-3">Plano</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Msgs</th>
                    <th className="px-4 py-3 text-right">Tokens</th>
                    <th className="px-4 py-3 text-right">Sessões</th>
                    <th className="px-4 py-3 text-right">Dur. méd. (min)</th>
                    <th className="px-4 py-3 text-right">Receita</th>
                    <th className="px-4 py-3 text-right">Custo IA</th>
                    <th className="px-4 py-3 text-right">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workspaces.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-content-muted">
                        Sem dados para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    data.workspaces.map((w) => (
                      <tr key={w.workspaceRef} className="border-b border-line/60 hover:bg-surface-elevated/20">
                        <td className="px-4 py-3 font-mono text-xs text-content-secondary">{w.label}</td>
                        <td className="px-4 py-3 text-content-secondary">{w.plan}</td>
                        <td className="px-4 py-3 text-content-secondary">{w.status}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatIntegerPtBr(w.messages)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatCompactNumber(w.tokensIn + w.tokensOut)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatIntegerPtBr(w.sessions)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{w.avgSessionDurationMin}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatBRL(w.revenueBrl)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatBRL(w.costIaBrl)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatBRL(w.marginBrl)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}
