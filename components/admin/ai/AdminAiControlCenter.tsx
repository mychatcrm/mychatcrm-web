"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";

type OverviewPayload = {
  kpis: {
    totalRequests: number;
    totalTokens: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
    errorRatePct: number;
    p95LatencyMs: number;
    uniqueTenants: number;
    uniqueAgents: number;
  };
};

type TenantRow = {
  tenantId: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  errorRatePct: number;
};

type AgentRow = {
  tenantId: string;
  agentId: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  errorRatePct: number;
  avgLatencyMs: number;
};

type LogRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  agent_id: string;
  model: string;
  status: string;
  total_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number | null;
  provider_request_id: string | null;
  error_code: string | null;
};

type OpenAiAccountPayload = {
  configured: boolean;
  credits: {
    totalGrantedUsd: number | null;
    totalUsedUsd: number | null;
    totalAvailableUsd: number | null;
  } | null;
  subscription: {
    hardLimitUsd: number | null;
    softLimitUsd: number | null;
    plan: string | null;
  } | null;
  usagePeriodUsd: number | null;
  usagePeriodLabel: string | null;
  hints: string[];
  fetchError: string | null;
};

function formatUsd(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function AdminAiControlCenter() {
  const today = new Date();
  const initialFrom = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(dateInput(initialFrom));
  const [to, setTo] = useState(dateInput(today));
  const [status, setStatus] = useState("all");
  const [openAi, setOpenAi] = useState<OpenAiAccountPayload | null>(null);
  const [openAiLoading, setOpenAiLoading] = useState(false);
  const [openAiErr, setOpenAiErr] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewPayload["kpis"] | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", `${from}T00:00:00.000Z`);
    p.set("to", `${to}T23:59:59.999Z`);
    if (status !== "all") p.set("status", status);
    return p.toString();
  }, [from, to, status]);

  const loadOpenAiAccount = useCallback(async () => {
    setOpenAiLoading(true);
    setOpenAiErr(null);
    try {
      const res = await fetch("/api/admin/ai/openai-account", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setOpenAiErr(typeof data?.error === "string" ? data.error : "Falha ao consultar conta OpenAI.");
        return;
      }
      setOpenAi(data as OpenAiAccountPayload);
    } catch {
      setOpenAiErr("Erro de rede ao consultar OpenAI.");
    } finally {
      setOpenAiLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOpenAiAccount();
  }, [loadOpenAiAccount]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [ra, rb, rc, rd, re] = await Promise.all([
          fetch(`/api/admin/ai/overview?${query}`),
          fetch(`/api/admin/ai/tenants?${query}`),
          fetch(`/api/admin/ai/agents?${query}`),
          fetch(`/api/admin/ai/logs?${query}&page=1&pageSize=25`),
          fetch(`/api/admin/ai/alerts?${query}`),
        ]);
        if (cancelled) return;
        if (!ra.ok || !rb.ok || !rc.ok || !rd.ok || !re.ok) {
          const failedStatus = [ra, rb, rc, rd, re].find((r) => !r.ok)?.status;
          if (failedStatus === 403) {
            setLoadError("Sem permissão para visualizar dados de IA.");
          } else if (failedStatus === 401) {
            setLoadError("Sessão expirada. Recarregue a página.");
          } else {
            setLoadError("Falha ao carregar dados. Tente novamente.");
          }
          return;
        }
        const [a, b, c, d, e] = await Promise.all([
          ra.json(), rb.json(), rc.json(), rd.json(), re.json(),
        ]);
        setOverview(a.kpis ?? null);
        setTenants(b.rows ?? []);
        setAgents(c.rows ?? []);
        setLogs(d.rows ?? []);
        setAlerts(e.rows ?? []);
      } catch {
        if (!cancelled) setLoadError("Erro de conexão ao carregar dados de IA.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const tenantColumns: Column<TenantRow>[] = [
    { key: "tenantId", header: "Tenant", render: (r) => r.tenantId },
    { key: "requests", header: "Requests", render: (r) => r.requests.toLocaleString("pt-BR") },
    { key: "totalTokens", header: "Tokens", render: (r) => r.totalTokens.toLocaleString("pt-BR") },
    { key: "estimatedCostUsd", header: "Custo", render: (r) => formatUsd(r.estimatedCostUsd) },
    { key: "errorRatePct", header: "Erro %", render: (r) => `${r.errorRatePct.toFixed(2)}%` },
  ];

  const agentColumns: Column<AgentRow>[] = [
    { key: "tenantId", header: "Tenant", render: (r) => r.tenantId },
    { key: "agentId", header: "Agente", render: (r) => r.agentId },
    { key: "requests", header: "Requests", render: (r) => r.requests.toLocaleString("pt-BR") },
    { key: "totalTokens", header: "Tokens", render: (r) => r.totalTokens.toLocaleString("pt-BR") },
    { key: "estimatedCostUsd", header: "Custo", render: (r) => formatUsd(r.estimatedCostUsd) },
    { key: "avgLatencyMs", header: "Latência", render: (r) => `${r.avgLatencyMs} ms` },
  ];

  const logColumns: Column<LogRow>[] = [
    { key: "created_at", header: "Data", render: (r) => new Date(r.created_at).toLocaleString("pt-BR") },
    { key: "tenant_id", header: "Tenant", render: (r) => r.tenant_id },
    { key: "agent_id", header: "Agente", render: (r) => r.agent_id },
    { key: "model", header: "Modelo", render: (r) => r.model },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "total_tokens", header: "Tokens", render: (r) => r.total_tokens.toLocaleString("pt-BR") },
    { key: "estimated_cost_usd", header: "Custo", render: (r) => formatUsd(r.estimated_cost_usd) },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-content">Conta OpenAI (saldo e limites)</h2>
            <p className="mt-1 text-[13px] text-content-muted">
              Dados diretos da API de billing da OpenAI. Os gráficos abaixo mostram consumo registrado no seu sistema (Supabase).
            </p>
          </div>
          <Button variant="secondary" type="button" disabled={openAiLoading} onClick={() => void loadOpenAiAccount()}>
            {openAiLoading ? "A consultar…" : "Atualizar saldo OpenAI"}
          </Button>
        </div>
        {openAiErr ? (
          <p className="mb-3 text-sm text-rose-400">{openAiErr}</p>
        ) : null}
        {!openAi && openAiLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-elevated/40" />
        ) : openAi && !openAi.configured ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-medium">OPENAI_API_KEY não configurada no servidor</p>
            <p className="mt-1 text-content-secondary">
              Adicione a variável em Vercel → Settings → Environment Variables (Production) e faça redeploy. Não commite a chave no Git.
            </p>
          </div>
        ) : openAi ? (
          <>
            {openAi.fetchError ? (
              <p className="mb-3 text-sm text-amber-400">{openAi.fetchError}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-content-muted">Crédito disponível (OpenAI)</p>
                <p className="text-lg font-semibold text-content">
                  {openAi.credits?.totalAvailableUsd != null
                    ? formatUsd(openAi.credits.totalAvailableUsd)
                    : "—"}
                </p>
                <p className="mt-1 text-[11px] text-content-faint">Pré-pago / grants na conta</p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-content-muted">Crédito usado / concedido</p>
                <p className="text-lg font-semibold text-content">
                  {openAi.credits?.totalUsedUsd != null && openAi.credits?.totalGrantedUsd != null
                    ? `${formatUsd(openAi.credits.totalUsedUsd)} / ${formatUsd(openAi.credits.totalGrantedUsd)}`
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-content-muted">Limite mensal (hard / soft)</p>
                <p className="text-lg font-semibold text-content">
                  {openAi.subscription?.hardLimitUsd != null || openAi.subscription?.softLimitUsd != null
                    ? `${openAi.subscription.hardLimitUsd != null ? formatUsd(openAi.subscription.hardLimitUsd) : "—"} / ${openAi.subscription.softLimitUsd != null ? formatUsd(openAi.subscription.softLimitUsd) : "—"}`
                    : "—"}
                </p>
                {openAi.subscription?.plan ? (
                  <p className="mt-1 text-[11px] text-content-faint">Plano: {openAi.subscription.plan}</p>
                ) : null}
              </div>
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-content-muted">{openAi.usagePeriodLabel ?? "Uso no período"}</p>
                <p className="text-lg font-semibold text-content">
                  {openAi.usagePeriodUsd != null ? formatUsd(openAi.usagePeriodUsd) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-content-faint">Faturação OpenAI (UTC)</p>
              </div>
            </div>
            {openAi.hints.length ? (
              <ul className="mt-4 list-inside list-disc space-y-1 text-[12px] text-content-faint">
                {openAi.hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>

      {loadError ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">
          {loadError}
        </div>
      ) : null}
      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap gap-3">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos os status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="blocked">Blocked</option>
            <option value="timeout">Timeout</option>
          </Select>
          {loading ? (
            <span className="flex items-center text-sm text-content-muted">Atualizando...</span>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs text-content-muted">Tokens</p>
            <p className="text-lg font-semibold text-content">{(overview?.totalTokens ?? 0).toLocaleString("pt-BR")}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs text-content-muted">Custo estimado</p>
            <p className="text-lg font-semibold text-content">{formatUsd(overview?.estimatedCostUsd ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs text-content-muted">Taxa de erro</p>
            <p className="text-lg font-semibold text-content">{(overview?.errorRatePct ?? 0).toFixed(2)}%</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs text-content-muted">p95 latência</p>
            <p className="text-lg font-semibold text-content">{overview?.p95LatencyMs ?? 0} ms</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs text-content-muted">Tenants ativos</p>
            <p className="text-lg font-semibold text-content">{overview?.uniqueTenants ?? 0}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <h2 className="mb-3 text-base font-semibold text-content">Top tenants por consumo</h2>
        <DataTable columns={tenantColumns} data={tenants} rowKey={(row) => row.tenantId} />
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <h2 className="mb-3 text-base font-semibold text-content">Top agentes por consumo</h2>
        <DataTable columns={agentColumns} data={agents} rowKey={(row) => `${row.tenantId}:${row.agentId}`} />
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <h2 className="mb-3 text-base font-semibold text-content">Logs de requests IA</h2>
        <DataTable columns={logColumns} data={logs} rowKey={(row) => row.id} />
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <h2 className="mb-3 text-base font-semibold text-content">Alertas</h2>
        <div className="space-y-2 text-sm text-content-secondary">
          {alerts.length === 0 ? <p>Sem alertas no período.</p> : null}
          {alerts.map((a, idx) => (
            <div key={idx} className="rounded-lg border border-line p-3">
              <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(a, null, 2)}</pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
