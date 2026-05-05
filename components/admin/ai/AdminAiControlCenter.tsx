"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";

const OPENAI_POLL_MS = 35_000;

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
  health?: {
    aiUsageLogsReachable: boolean;
    aiUsageLogsError: string | null;
    aiUsageLogsHint?: string | null;
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

type OpenAiEndpointName =
  | "credit_grants"
  | "subscription"
  | "usage"
  | "connectivity_models"
  | "organization_costs";

type OpenAiEndpointStatus = {
  httpStatus: number;
  ok: boolean;
  errorMessage: string | null;
};

type OpenAiBillingApiAccess = "ok" | "forbidden_project_key" | "billing_unreachable" | "unknown";

type OpenAiKeyEffectiveSource = "env" | "database" | "none";

type IntegrationStatusPayload = {
  hasOpenAiKey: boolean;
  openAiKeySource: OpenAiKeyEffectiveSource;
  envOpenAiKeyConfigured: boolean;
  aiUsageLogsReachable: boolean;
  aiUsageLogsError: string | null;
  aiUsageLogsHint?: string | null;
  requestsLast24h: number | null;
  lastSuccess: { createdAt: string; tenantId: string; agentId: string } | null;
};

type OpenAiCredentialsPayload = {
  envConfigured: boolean;
  databaseConfigured: boolean;
  effectiveSource: OpenAiKeyEffectiveSource;
  maskedSuffix: string | null;
};

type OpenAiAccountPayload = {
  configured: boolean;
  connectivityOk: boolean | null;
  endpointStatus: Partial<Record<OpenAiEndpointName, OpenAiEndpointStatus>>;
  billingApiAccess?: OpenAiBillingApiAccess | null;
  credits: {
    totalGrantedUsd: number | null;
    totalUsedUsd: number | null;
    totalAvailableUsd: number | null;
  } | null;
  creditsParseSource: "root" | "aggregated" | "none" | null;
  subscription: {
    hardLimitUsd: number | null;
    softLimitUsd: number | null;
    plan: string | null;
  } | null;
  usagePeriodUsd: number | null;
  usageUnit: "usd" | "cents_normalized" | null;
  usageDataSource?: "dashboard_billing" | "organization_costs" | null;
  usagePeriodLabel: string | null;
  accountBillingMode: "prepaid_grants" | "postpaid_or_no_grants" | "unknown";
  hints: string[];
  fetchError: string | null;
  rateLimited: boolean;
  suggestedRetryAfterSec: number | null;
  serverCache?: { hit: boolean; ttlMs: number; ageMs: number };
};

function formatUsd(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v || 0);
}

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function endpointTitle(name: OpenAiEndpointName): string {
  switch (name) {
    case "credit_grants":
      return "credit_grants";
    case "subscription":
      return "subscription";
    case "usage":
      return "usage (mês)";
    case "connectivity_models":
      return "models (probe)";
    case "organization_costs":
      return "organization/costs";
    default:
      return name;
  }
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
  const [lastOpenAiSync, setLastOpenAiSync] = useState<string | null>(null);
  const [liveSync, setLiveSync] = useState(true);
  const rateLimitUntilRef = useRef(0);

  const [overview, setOverview] = useState<OverviewPayload["kpis"] | null>(null);
  const [overviewHealth, setOverviewHealth] = useState<OverviewPayload["health"] | null>(null);
  const [integration, setIntegration] = useState<IntegrationStatusPayload | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<OpenAiCredentialsPayload | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credErr, setCredErr] = useState<string | null>(null);
  const [openAiKeyInput, setOpenAiKeyInput] = useState("");
  const [credSaving, setCredSaving] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", `${from}T00:00:00.000Z`);
    p.set("to", `${to}T23:59:59.999Z`);
    if (status !== "all") p.set("status", status);
    return p.toString();
  }, [from, to, status]);

  const loadInternalBundle = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ra, rb, rc, rd, re, rf] = await Promise.all([
        fetch(`/api/admin/ai/overview?${query}`),
        fetch(`/api/admin/ai/tenants?${query}`),
        fetch(`/api/admin/ai/agents?${query}`),
        fetch(`/api/admin/ai/logs?${query}&page=1&pageSize=25`),
        fetch(`/api/admin/ai/alerts?${query}`),
        fetch(`/api/admin/ai/integration-status`, { credentials: "include", cache: "no-store" }),
      ]);
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
        ra.json(),
        rb.json(),
        rc.json(),
        rd.json(),
        re.json(),
      ]);
      setOverview(a.kpis ?? null);
      setOverviewHealth(a.health ?? null);
      setTenants(b.rows ?? []);
      setAgents(c.rows ?? []);
      setLogs(d.rows ?? []);
      setAlerts(e.rows ?? []);
      if (rf.ok) {
        const int = (await rf.json()) as IntegrationStatusPayload;
        setIntegration(int);
      } else {
        setIntegration(null);
      }
    } catch {
      setLoadError("Erro de conexão ao carregar dados de IA.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadOpenAiAccount = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && Date.now() < rateLimitUntilRef.current) return;

    setOpenAiLoading(true);
    setOpenAiErr(null);
    try {
      const res = await fetch("/api/admin/ai/openai-account", { credentials: "include", cache: "no-store" });
      const data = (await res.json()) as OpenAiAccountPayload & { error?: string };
      if (!res.ok) {
        setOpenAiErr(typeof data?.error === "string" ? data.error : "Falha ao consultar conta OpenAI.");
        return;
      }
      setOpenAi(data);
      setLastOpenAiSync(new Date().toLocaleString("pt-BR"));
      if (data.rateLimited) {
        const sec = data.suggestedRetryAfterSec ?? 60;
        rateLimitUntilRef.current = Date.now() + sec * 1000;
      } else {
        rateLimitUntilRef.current = 0;
      }
    } catch {
      setOpenAiErr("Erro de rede ao consultar OpenAI.");
    } finally {
      setOpenAiLoading(false);
    }
  }, []);

  const loadOpenAiCredentials = useCallback(async () => {
    setCredLoading(true);
    setCredErr(null);
    try {
      const res = await fetch("/api/admin/ai/openai-credentials", { credentials: "include", cache: "no-store" });
      const data = (await res.json()) as OpenAiCredentialsPayload & { error?: string };
      if (!res.ok) {
        setCredErr(typeof data?.error === "string" ? data.error : "Falha ao carregar credenciais.");
        setCredentials(null);
        return;
      }
      setCredentials(data);
    } catch {
      setCredErr("Erro de rede ao carregar credenciais.");
      setCredentials(null);
    } finally {
      setCredLoading(false);
    }
  }, []);

  const saveOpenAiKey = useCallback(async () => {
    const key = openAiKeyInput.trim();
    if (!key) {
      setCredErr("Cole a chave OpenAI (sk-…).");
      return;
    }
    setCredSaving(true);
    setCredErr(null);
    try {
      const res = await fetch("/api/admin/ai/openai-credentials", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey: key }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string } & Partial<OpenAiCredentialsPayload>;
      if (!res.ok) {
        setCredErr(typeof data?.error === "string" ? data.error : "Falha ao guardar.");
        return;
      }
      setOpenAiKeyInput("");
      setCredentials({
        envConfigured: Boolean(data.envConfigured),
        databaseConfigured: Boolean(data.databaseConfigured),
        effectiveSource: (data.effectiveSource ?? "none") as OpenAiKeyEffectiveSource,
        maskedSuffix: data.maskedSuffix ?? null,
      });
      void loadOpenAiAccount({ force: true });
      void loadInternalBundle();
    } catch {
      setCredErr("Erro de rede ao guardar.");
    } finally {
      setCredSaving(false);
    }
  }, [openAiKeyInput, loadOpenAiAccount, loadInternalBundle]);

  const removeOpenAiKeyFromPanel = useCallback(async () => {
    setCredSaving(true);
    setCredErr(null);
    try {
      const res = await fetch("/api/admin/ai/openai-credentials", {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string } & Partial<OpenAiCredentialsPayload>;
      if (!res.ok) {
        setCredErr(typeof data?.error === "string" ? data.error : "Falha ao remover.");
        return;
      }
      setCredentials({
        envConfigured: Boolean(data.envConfigured),
        databaseConfigured: Boolean(data.databaseConfigured),
        effectiveSource: (data.effectiveSource ?? "none") as OpenAiKeyEffectiveSource,
        maskedSuffix: data.maskedSuffix ?? null,
      });
      void loadOpenAiAccount({ force: true });
      void loadInternalBundle();
    } catch {
      setCredErr("Erro de rede ao remover.");
    } finally {
      setCredSaving(false);
    }
  }, [loadOpenAiAccount, loadInternalBundle]);

  useEffect(() => {
    void loadOpenAiAccount();
  }, [loadOpenAiAccount]);

  useEffect(() => {
    void loadOpenAiCredentials();
  }, [loadOpenAiCredentials]);

  useEffect(() => {
    void loadInternalBundle();
  }, [loadInternalBundle]);

  useEffect(() => {
    if (!liveSync) return;
    const id = window.setInterval(() => {
      if (Date.now() < rateLimitUntilRef.current) return;
      void loadOpenAiAccount();
      void loadInternalBundle();
    }, OPENAI_POLL_MS);
    return () => window.clearInterval(id);
  }, [liveSync, loadOpenAiAccount, loadInternalBundle]);

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

  const endpointRows = openAi?.endpointStatus
    ? (Object.entries(openAi.endpointStatus) as [OpenAiEndpointName, OpenAiEndpointStatus][])
    : [];

  const showOpenAiPostpaidHint =
    openAi?.configured &&
    openAi.accountBillingMode === "postpaid_or_no_grants" &&
    !openAi.credits;

  const usageSubtitle =
    openAi?.usageDataSource === "organization_costs"
      ? "Fonte: API oficial Organization Costs (USD agregados no período)."
      : openAi?.usageUnit === "cents_normalized"
        ? "Valores em USD (a API devolveu centavos; convertido ÷100)."
        : "Faturação OpenAI (UTC), billing legado quando disponível.";

  const showBilling403Info =
    openAi?.configured &&
    openAi.connectivityOk === true &&
    openAi.billingApiAccess === "forbidden_project_key";

  const keySourceLabel = (src: OpenAiKeyEffectiveSource) => {
    switch (src) {
      case "env":
        return "variável OPENAI_API_KEY no servidor (prioridade)";
      case "database":
        return "chave guardada neste painel (Supabase, cifrada)";
      default:
        return "nenhuma configurada";
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-content">Chave OpenAI da plataforma</h2>
        <p className="mt-1 text-[13px] text-content-muted">
          A mesma credencial alimenta o gateway usado por todos os agentes: prompts em{" "}
          <code className="text-[12px]">tenant_agents</code> (ou templates), chamadas a{" "}
          <code className="text-[12px]">/api/chat</code>, webhook WhatsApp e restantes fluxos{" "}
          <code className="text-[12px]">generateAgentResponse</code>. Se existir{" "}
          <code className="text-[12px]">OPENAI_API_KEY</code> na Vercel, ela tem prioridade sobre a chave guardada aqui.
        </p>
        <p className="mt-2 text-[12px] text-content-faint">
          Para cifrar no Supabase usa-se <code className="text-[11px]">PLATFORM_OPENAI_KEY_SECRET</code> (recomendado)
          ou, se não existir, <code className="text-[11px]">CLIENT_SESSION_COOKIE_SECRET</code> (mín. 8 caracteres). A
          chave nunca é mostrada por completo após guardar.
        </p>
        {credErr ? <p className="mt-3 text-sm text-rose-400">{credErr}</p> : null}
        {credLoading && !credentials ? (
          <div className="mt-4 h-16 animate-pulse rounded-lg bg-surface-elevated/40" />
        ) : (
          <div className="mt-4 space-y-3">
            {credentials ? (
              <ul className="list-inside list-disc space-y-1 text-[13px] text-content-secondary">
                <li>
                  Variável no servidor:{" "}
                  <strong className={credentials.envConfigured ? "text-emerald-400" : "text-content-muted"}>
                    {credentials.envConfigured ? "definida" : "não definida"}
                  </strong>
                </li>
                <li>
                  Chave cifrada no Supabase:{" "}
                  <strong className={credentials.databaseConfigured ? "text-emerald-400" : "text-content-muted"}>
                    {credentials.databaseConfigured ? "sim" : "não"}
                  </strong>
                </li>
                <li>
                  Origem em uso agora:{" "}
                  <strong className="text-content">{keySourceLabel(credentials.effectiveSource)}</strong>
                  {credentials.maskedSuffix ? (
                    <span className="text-content-muted">
                      {" "}
                      (máscara <code className="text-[11px]">{credentials.maskedSuffix}</code>)
                    </span>
                  ) : null}
                </li>
              </ul>
            ) : (
              <p className="text-[13px] text-content-muted">
                Não foi possível carregar o estado (ver mensagem acima). Ainda podes colar a chave e guardar — confirma
                migração <code className="text-[11px]">admin_platform_openai</code> no Supabase e permissão &quot;ia&quot; na
                sessão admin.
              </p>
            )}
            <div className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs text-content-muted" htmlFor="admin-openai-key">
                  Nova chave (sk-…)
                </label>
                <Input
                  id="admin-openai-key"
                  type="password"
                  autoComplete="off"
                  value={openAiKeyInput}
                  onChange={(e) => setOpenAiKeyInput(e.target.value)}
                  placeholder="sk-…"
                />
              </div>
              <Button type="button" disabled={credSaving} onClick={() => void saveOpenAiKey()}>
                {credSaving ? "A guardar…" : "Guardar no painel"}
              </Button>
              {credentials?.databaseConfigured ? (
                <Button
                  variant="secondary"
                  type="button"
                  disabled={credSaving}
                  onClick={() => void removeOpenAiKeyFromPanel()}
                >
                  Remover do painel
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-content">OpenAI (oficial)</h2>
            <p className="mt-1 text-[13px] text-content-muted">
              Saldo, limites e uso via API de billing da OpenAI. Não confundir com o consumo registado no MyChatCRM
              (secção seguinte — dados em <code className="text-[12px]">ai_usage_logs</code> no Supabase).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" type="button" onClick={() => setLiveSync((v) => !v)}>
              {liveSync ? "Pausar atualização automática" : "Retomar atualização automática"}
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={openAiLoading}
              onClick={() => void loadOpenAiAccount({ force: true })}
            >
              {openAiLoading ? "A consultar…" : "Atualizar agora"}
            </Button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-content-faint">
          {liveSync ? <span>Atualização a cada {OPENAI_POLL_MS / 1000}s (OpenAI + dados internos do período).</span> : null}
          {lastOpenAiSync ? (
            <span>
              Última sincronização OpenAI: <strong className="font-medium text-content-muted">{lastOpenAiSync}</strong>
            </span>
          ) : null}
          {openAi?.serverCache?.hit ? (
            <span>
              Cache servidor ~{Math.round(openAi.serverCache.ttlMs / 1000)}s (hit, idade ~{Math.round(openAi.serverCache.ageMs / 1000)}s)
            </span>
          ) : null}
        </div>
        {integration ? (
          <div className="mb-4 rounded-lg border border-line bg-surface-elevated/25 p-3 text-[13px] text-content-secondary">
            <p className="font-medium text-content">Estado da integração (runtime)</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                Chave OpenAI (runtime):{" "}
                <strong className={integration.hasOpenAiKey ? "text-emerald-400" : "text-rose-400"}>
                  {integration.hasOpenAiKey ? "configurada" : "ausente"}
                </strong>
                {integration.hasOpenAiKey ? (
                  <span className="text-content-muted">
                    {" "}
                    — origem: {keySourceLabel(integration.openAiKeySource ?? "none")}
                  </span>
                ) : null}
              </li>
              <li>
                Tabela ai_usage_logs:{" "}
                <strong className={integration.aiUsageLogsReachable ? "text-emerald-400" : "text-rose-400"}>
                  {integration.aiUsageLogsReachable ? "acessível" : "inacessível"}
                </strong>
                {integration.aiUsageLogsError ? ` (${integration.aiUsageLogsError})` : ""}
              </li>
              {integration.aiUsageLogsHint && !integration.aiUsageLogsReachable ? (
                <li className="list-none pl-0 text-[12px] text-amber-200/95">
                  {integration.aiUsageLogsHint}
                </li>
              ) : null}
              <li>
                Pedidos registados (últimas 24h):{" "}
                <strong className="text-content">{integration.requestsLast24h ?? "—"}</strong>
              </li>
              <li>
                Última chamada com sucesso:{" "}
                {integration.lastSuccess ? (
                  <span>
                    {new Date(integration.lastSuccess.createdAt).toLocaleString("pt-BR")} · tenant{" "}
                    <code className="text-[11px]">{integration.lastSuccess.tenantId}</code> · agente{" "}
                    <code className="text-[11px]">{integration.lastSuccess.agentId}</code>
                  </span>
                ) : (
                  <span>—</span>
                )}
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-content-faint">
              Isto reflete chamadas reais ao gateway (ex.: /api/chat), não o billing externo da OpenAI.
            </p>
          </div>
        ) : null}
        {openAiErr ? <p className="mb-3 text-sm text-rose-400">{openAiErr}</p> : null}
        {openAi?.rateLimited ? (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Limite de pedidos à OpenAI (429). Próximas tentativas respeitam{" "}
            <strong>Retry-After</strong>
            {openAi.suggestedRetryAfterSec != null ? ` (~${openAi.suggestedRetryAfterSec}s)` : ""}. O painel volta a
            consultar sozinho após esse intervalo.
          </p>
        ) : null}
        {!openAi && openAiLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-elevated/40" />
        ) : openAi && !openAi.configured ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-medium">Nenhuma chave OpenAI disponível para o painel consultar a API</p>
            <p className="mt-1 text-content-secondary">
              Defina <code className="text-[11px]">OPENAI_API_KEY</code> na Vercel (prioridade) ou guarde a chave na
              secção <strong>Chave OpenAI da plataforma</strong> acima (com <code className="text-[11px]">PLATFORM_OPENAI_KEY_SECRET</code>{" "}
              e migração <code className="text-[11px]">admin_platform_openai</code> no Supabase). Não commite chaves no Git.
            </p>
          </div>
        ) : openAi ? (
          <>
            {openAi.connectivityOk === false ? (
              <p className="mb-3 text-sm text-amber-400">
                A chave não passou no probe <code className="text-xs">GET /v1/models</code> — confirme a chave antes de
                interpretar o billing.
              </p>
            ) : null}
            {showBilling403Info ? (
              <div className="mb-3 rounded-lg border border-sky-500/35 bg-sky-500/10 p-3 text-[13px] text-sky-100">
                <p className="font-medium text-content">Chave OK para modelos; billing legado bloqueado (403)</p>
                <p className="mt-1 text-content-secondary">
                  Isto é normal com chaves de projeto. Saldo e faturação oficial:{" "}
                  <a
                    className="underline"
                    href="https://platform.openai.com/settings/organization/billing/overview"
                    target="_blank"
                    rel="noreferrer"
                  >
                    platform.openai.com → Billing
                  </a>
                  . Para custos agregados neste painel, configure{" "}
                  <code className="text-[11px]">OPENAI_ADMIN_API_KEY</code> na Vercel (Production) e faça redeploy.
                </p>
              </div>
            ) : null}
            {openAi.fetchError ? <p className="mb-3 text-sm text-amber-400">{openAi.fetchError}</p> : null}
            {showOpenAiPostpaidHint ? (
              <div className="mb-3 rounded-lg border border-line bg-surface-elevated/30 p-3 text-[13px] text-content-secondary">
                <p className="font-medium text-content">Conta pós-pago ou sem saldo pré-pago visível na API</p>
                <p className="mt-1">
                  Não há <em>credit grants</em> para mostrar — isto é esperado em muitas contas só pós-pago. Use limite
                  mensal e uso oficial abaixo; o extrato completo está no dashboard OpenAI.
                </p>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-line p-3">
                <p className="text-xs text-content-muted">Crédito disponível (pré-pago)</p>
                <p className="text-lg font-semibold text-content">
                  {openAi.credits?.totalAvailableUsd != null ? formatUsd(openAi.credits.totalAvailableUsd) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-content-faint">
                  {openAi.creditsParseSource && openAi.creditsParseSource !== "none"
                    ? `Fonte: ${openAi.creditsParseSource}`
                    : "Só contas com grants na API"}
                </p>
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
                <p className="mt-1 text-[11px] text-content-faint">{usageSubtitle}</p>
              </div>
            </div>
            {openAi.hints.length ? (
              <ul className="mt-4 list-inside list-disc space-y-1 text-[12px] text-content-faint">
                {openAi.hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : null}

            {endpointRows.length > 0 ? (
              <details className="mt-4 rounded-lg border border-line bg-surface-elevated/20 p-3">
                <summary className="cursor-pointer text-sm font-medium text-content">
                  Diagnóstico da API (HTTP por endpoint)
                </summary>
                <ul className="mt-3 space-y-2 text-[12px] text-content-secondary">
                  {endpointRows.map(([key, st]) => (
                    <li key={key}>
                      <span className="font-mono text-content-muted">{endpointTitle(key)}</span>: HTTP {st.httpStatus}{" "}
                      {st.ok ? "ok" : "falhou"}
                      {st.errorMessage ? (
                        <span className="block pl-0 text-rose-300/90">
                          {st.errorMessage.length > 280 ? `${st.errorMessage.slice(0, 280)}…` : st.errorMessage}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </section>

      {loadError ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">{loadError}</div>
      ) : null}

      <section className="rounded-xl border border-line bg-surface-card p-5 sm:p-6">
        <h2 className="mb-1 text-base font-semibold text-content">Consumo no MyChatCRM (registos internos)</h2>
        <p className="mb-4 text-[13px] text-content-muted">
          KPIs abaixo vêm de <code className="text-[12px]">ai_usage_logs</code> (o que o backend registou). Não substitui
          o extrato oficial OpenAI. O período aplicado é o intervalo de datas — o cartão “uso OpenAI” acima é sempre o mês
          civil UTC.
        </p>
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
          {loading ? <span className="flex items-center text-sm text-content-muted">Atualizando...</span> : null}
        </div>
        {overviewHealth && !overviewHealth.aiUsageLogsReachable ? (
          <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            <p className="font-medium">Não foi possível ler a tabela ai_usage_logs</p>
            <p className="mt-1 text-[13px] text-rose-200/90">
              {overviewHealth.aiUsageLogsError ?? "Erro desconhecido."} Migração base:{" "}
              <code className="text-[11px]">20260505_ai_gateway_usage_tracking.sql</code>; políticas RLS (se aplicável):{" "}
              <code className="text-[11px]">20260508_ai_usage_rls_service_role_policies.sql</code>.
            </p>
            {overviewHealth.aiUsageLogsHint ? (
              <p className="mt-2 text-[12px] text-amber-100/95">{overviewHealth.aiUsageLogsHint}</p>
            ) : null}
          </div>
        ) : null}
        {overviewHealth?.aiUsageLogsReachable &&
        overview &&
        overview.totalRequests === 0 &&
        !loadError ? (
          <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-[13px] text-amber-100">
            <p className="font-medium text-content">Sem registos no período</p>
            <p className="mt-1 text-content-secondary">
              A tabela existe mas está vazia para as datas escolhidas. Gere tráfego real em{" "}
              <code className="text-[11px]">/api/chat</code> (com tenant e agente válidos) ou alargue o intervalo de
              datas. Após alterações no código, faça <strong>redeploy</strong> na Vercel para ver a UI mais recente.
            </p>
          </div>
        ) : null}
        {overview != null &&
        openAi?.usagePeriodUsd != null &&
        openAi.configured &&
        !openAi.fetchError ? (
          <p className="mb-3 text-[12px] text-content-faint">
            Referência: custo estimado interno no período {formatUsd(overview.estimatedCostUsd)} · custo/uso OpenAI
            (painel acima:{" "}
            {openAi.usageDataSource === "organization_costs"
              ? "Organization Costs API"
              : "billing legado / mês UTC"}
            ) {formatUsd(openAi.usagePeriodUsd)} — períodos e fontes diferentes; não é reconciliação automática.
          </p>
        ) : null}
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
