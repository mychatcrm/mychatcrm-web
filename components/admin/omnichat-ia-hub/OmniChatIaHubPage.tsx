"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Column } from "@/components/ui/DataTable";
import { DataTable } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { hubGlass, hubGlowTitle, hubPageBg } from "@/components/admin/omnichat-ia-hub/hub-surface";
import { HubOpenAiPanel } from "@/components/admin/omnichat-ia-hub/HubOpenAiPanel";
import { OPENAI_POLL_MS } from "@/components/admin/omnichat-ia-hub/constants";
import { cn } from "@/lib/utils";
import type { AiTimeseriesPoint } from "@/lib/ai/admin-metrics";
import type { AiUsageLimitRow } from "@/lib/ai/admin-metrics";
import type { OpenAiTestConnectionPayload } from "@/lib/ai/admin-ia-hub-types";
import type {
  AgentRow,
  IntegrationStatusPayload,
  LogRow,
  OpenAiAccountPayload,
  OpenAiCredentialsPayload,
  OpenAiKeyEffectiveSource,
  OverviewPayload,
  TenantRow,
} from "@/components/admin/ai/ia-admin-types";
import { dateInput, formatUsd, keySourceLabel } from "@/components/admin/ai/ia-admin-types";

const HubTimeseriesChart = dynamic(
  () => import("@/components/admin/omnichat-ia-hub/HubTimeseriesChart").then((m) => ({ default: m.HubTimeseriesChart })),
  {
    ssr: false,
    loading: () => <div className={cn(hubGlass, "h-[280px] animate-pulse bg-white/[0.04]")} />,
  },
);

export function OmniChatIaHubPage() {
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
  const verificationRunRef = useRef(0);
  const [verificationBusy, setVerificationBusy] = useState(false);

  const [overview, setOverview] = useState<OverviewPayload["kpis"] | null>(null);
  const [overviewHealth, setOverviewHealth] = useState<OverviewPayload["health"] | null>(null);
  const [integration, setIntegration] = useState<IntegrationStatusPayload | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [timeseries, setTimeseries] = useState<AiTimeseriesPoint[]>([]);
  const [limits, setLimits] = useState<AiUsageLimitRow[]>([]);
  const [limitsHint, setLimitsHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<OpenAiCredentialsPayload | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credErr, setCredErr] = useState<string | null>(null);
  const [openAiKeyInput, setOpenAiKeyInput] = useState("");
  const [credSaving, setCredSaving] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<OpenAiTestConnectionPayload | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", `${from}T00:00:00.000Z`);
    p.set("to", `${to}T23:59:59.999Z`);
    if (status !== "all") p.set("status", status);
    return p.toString();
  }, [from, to, status]);

  const loadTimeseries = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/ai/timeseries?${query}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { series?: AiTimeseriesPoint[] };
      setTimeseries(j.series ?? []);
    } catch {
      setTimeseries([]);
    }
  }, [query]);

  const loadUsageLimits = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/usage-limits", { credentials: "include", cache: "no-store" });
      const j = (await res.json()) as { rows?: AiUsageLimitRow[]; hint?: string };
      setLimits(j.rows ?? []);
      setLimitsHint(typeof j.hint === "string" ? j.hint : null);
    } catch {
      setLimits([]);
    }
  }, []);

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
        fetch("/api/admin/ai/integration-status", { credentials: "include", cache: "no-store" }),
      ]);
      if (!ra.ok || !rb.ok || !rc.ok || !rd.ok || !re.ok) {
        const failedStatus = [ra, rb, rc, rd, re].find((r) => !r.ok)?.status;
        if (failedStatus === 403) setLoadError("Sem permissão para visualizar dados de IA.");
        else if (failedStatus === 401) setLoadError("Sessão expirada. Recarregue a página.");
        else setLoadError("Falha ao carregar dados. Tente novamente.");
        return;
      }
      const [a, b, c, d, e] = await Promise.all([ra.json(), rb.json(), rc.json(), rd.json(), re.json()]);
      setOverview(a.kpis ?? null);
      setOverviewHealth(a.health ?? null);
      setTenants(b.rows ?? []);
      setAgents(c.rows ?? []);
      setLogs(d.rows ?? []);
      setAlerts(e.rows ?? []);
      if (rf.ok) setIntegration((await rf.json()) as IntegrationStatusPayload);
      else setIntegration(null);
      void loadTimeseries();
      void loadUsageLimits();
    } catch {
      setLoadError("Erro de conexão ao carregar dados de IA.");
    } finally {
      setLoading(false);
    }
  }, [query, loadTimeseries, loadUsageLimits]);

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
        rateLimitUntilRef.current = Date.now() + (data.suggestedRetryAfterSec ?? 60) * 1000;
      } else {
        rateLimitUntilRef.current = 0;
      }
    } catch {
      setOpenAiErr("Erro de rede ao consultar OpenAI.");
    } finally {
      setOpenAiLoading(false);
    }
  }, []);

  const runSequentialVerification = useCallback(async () => {
    const runId = ++verificationRunRef.current;
    setVerificationBusy(true);
    try {
      await loadOpenAiAccount({ force: true });
      await loadInternalBundle();
    } finally {
      if (verificationRunRef.current === runId) setVerificationBusy(false);
    }
  }, [loadOpenAiAccount, loadInternalBundle]);

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
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        details?: string;
        code?: string | null;
        hint?: string;
      } & Partial<OpenAiCredentialsPayload>;
      if (!res.ok) {
        const base = typeof data?.error === "string" ? data.error : "Falha ao guardar.";
        const extra =
          typeof data?.details === "string" && data.details.trim()
            ? ` ${data.details.trim()}${data.code ? ` (código: ${data.code})` : ""}`
            : "";
        const hint = typeof data?.hint === "string" && data.hint.trim() ? ` ${data.hint.trim()}` : "";
        setCredErr(base + extra + hint);
        return;
      }
      setOpenAiKeyInput("");
      setCredentials({
        envConfigured: Boolean(data.envConfigured),
        databaseConfigured: Boolean(data.databaseConfigured),
        effectiveSource: (data.effectiveSource ?? "none") as OpenAiKeyEffectiveSource,
        maskedSuffix: data.maskedSuffix ?? null,
      });
      setTestResult(null);
      await runSequentialVerification();
    } catch {
      setCredErr("Erro de rede ao guardar.");
    } finally {
      setCredSaving(false);
    }
  }, [openAiKeyInput, runSequentialVerification]);

  const removeOpenAiKeyFromPanel = useCallback(async () => {
    setCredSaving(true);
    setCredErr(null);
    try {
      const res = await fetch("/api/admin/ai/openai-credentials", { method: "DELETE", credentials: "include" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        details?: string;
        code?: string | null;
        hint?: string;
      } & Partial<OpenAiCredentialsPayload>;
      if (!res.ok) {
        const base = typeof data?.error === "string" ? data.error : "Falha ao remover.";
        const extra =
          typeof data?.details === "string" && data.details.trim()
            ? ` ${data.details.trim()}${data.code ? ` (código: ${data.code})` : ""}`
            : "";
        const hint = typeof data?.hint === "string" && data.hint.trim() ? ` ${data.hint.trim()}` : "";
        setCredErr(base + extra + hint);
        return;
      }
      setCredentials({
        envConfigured: Boolean(data.envConfigured),
        databaseConfigured: Boolean(data.databaseConfigured),
        effectiveSource: (data.effectiveSource ?? "none") as OpenAiKeyEffectiveSource,
        maskedSuffix: data.maskedSuffix ?? null,
      });
      setTestResult(null);
      await runSequentialVerification();
    } catch {
      setCredErr("Erro de rede ao remover.");
    } finally {
      setCredSaving(false);
    }
  }, [runSequentialVerification]);

  const runTestConnection = useCallback(async () => {
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/ai/test-connection", { method: "POST", credentials: "include" });
      const data = (await res.json()) as OpenAiTestConnectionPayload;
      setTestResult(data);
    } catch {
      setTestResult({
        ok: false,
        code: "NETWORK",
        latencyMs: null,
        httpStatus: null,
        message: "Falha de rede ao testar.",
      });
    } finally {
      setTestBusy(false);
    }
  }, []);

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

  const tenantColumns: Column<TenantRow>[] = useMemo(
    () => [
      { key: "tenantId", header: "Tenant", render: (r) => <span className="text-zinc-200">{r.tenantId}</span> },
      { key: "requests", header: "Req", render: (r) => r.requests.toLocaleString("pt-BR") },
      { key: "totalTokens", header: "Tokens", render: (r) => r.totalTokens.toLocaleString("pt-BR") },
      { key: "estimatedCostUsd", header: "USD", render: (r) => formatUsd(r.estimatedCostUsd) },
    ],
    [],
  );
  const agentColumns: Column<AgentRow>[] = useMemo(
    () => [
      { key: "tenantId", header: "Tenant", render: (r) => r.tenantId },
      { key: "agentId", header: "Agente", render: (r) => r.agentId },
      { key: "requests", header: "Req", render: (r) => r.requests.toLocaleString("pt-BR") },
      { key: "totalTokens", header: "Tokens", render: (r) => r.totalTokens.toLocaleString("pt-BR") },
      { key: "estimatedCostUsd", header: "USD", render: (r) => formatUsd(r.estimatedCostUsd) },
    ],
    [],
  );
  const logColumns: Column<LogRow>[] = useMemo(
    () => [
      { key: "created_at", header: "Data", render: (r) => new Date(r.created_at).toLocaleString("pt-BR") },
      { key: "tenant_id", header: "Tenant", render: (r) => r.tenant_id },
      { key: "agent_id", header: "Agente", render: (r) => r.agent_id },
      { key: "status", header: "St", render: (r) => r.status },
      { key: "total_tokens", header: "Tok", render: (r) => r.total_tokens.toLocaleString("pt-BR") },
    ],
    [],
  );

  const runtimeOk = integration?.hasOpenAiKey;
  const logsOk = integration?.aiUsageLogsReachable;

  return (
    <div className={cn(hubPageBg, "p-4 sm:p-6 lg:p-8")}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="mx-auto max-w-7xl space-y-8">
        <header className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-violet-300/90">OmniChat</p>
          <h1 className={cn("text-3xl font-bold tracking-tight sm:text-4xl", hubGlowTitle)}>Centro de IA · Atendimento</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
            Gestão da credencial que alimenta <strong className="text-zinc-200">só os agentes de atendimento</strong> dos teus clientes
            (inferência, <code className="rounded bg-white/5 px-1 text-[11px]">/api/chat</code>, canais). Prioridade:{" "}
            <code className="text-[11px] text-sky-300/90">OPENAI_API_KEY</code> na Vercel, depois chave cifrada aqui.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-12">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className={cn(hubGlass, "p-5 sm:p-6 lg:col-span-5")}
          >
            <h2 className="text-sm font-semibold text-zinc-100">API Key · ligação</h2>
            <p className="mt-1 text-xs text-zinc-500">Valor nunca exposto completo. Cifra no servidor.</p>
            <div className="mt-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.07] p-3 text-[11px] leading-relaxed text-zinc-300">
              <p className="font-semibold text-sky-200/95">Porque o teste pode dar certo e guardar falhar</p>
              <p className="mt-1.5 text-zinc-400">
                <strong className="text-zinc-200">Testar conexão</strong> só chama a API da OpenAI (<code className="rounded bg-black/30 px-1 text-[10px] text-zinc-300">/v1/models</code>) com a
                chave já resolvida no servidor (muitas vezes <code className="text-[10px] text-sky-300/90">OPENAI_API_KEY</code> na Vercel).{" "}
                <strong className="text-zinc-200">Conectar / guardar</strong> grava no Postgres do Supabase (tabela{" "}
                <code className="text-[10px] text-zinc-400">admin_platform_openai</code>) — precisa de{" "}
                <code className="text-[10px] text-zinc-400">SUPABASE_SERVICE_ROLE_KEY</code> como secret <em>service_role</em> (nunca a chave{" "}
                <em>anon</em>) do <strong className="text-zinc-200">mesmo</strong> projecto que <code className="text-[10px] text-zinc-400">NEXT_PUBLIC_SUPABASE_URL</code>, migrações{" "}
                <code className="text-[10px] text-zinc-500">20260507</code>, <code className="text-[10px] text-zinc-500">20260508</code>,{" "}
                <code className="text-[10px] text-zinc-500">20260510–20260511</code> no Supabase, e redeploy na Vercel após alterar envs.
              </p>
            </div>
            {credErr ? (
              <div className="mt-2 space-y-2" role="alert">
                <p className="text-sm text-rose-400">{credErr}</p>
                {credErr.includes("Supabase") || credErr.includes("permission") || credErr.includes("does not exist") ? (
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    Em <strong className="text-zinc-400">produção</strong>: Vercel → Project → Settings → Environment Variables →{" "}
                    <strong className="text-zinc-400">Production</strong> — confirme <code className="text-zinc-400">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
                    <code className="text-zinc-400">SUPABASE_SERVICE_ROLE_KEY</code> (secret <strong>service_role</strong>, não <em>anon</em>). Local:{" "}
                    <code className="text-zinc-400">.env.local</code>. No Supabase (SQL), aplique{" "}
                    <code className="text-zinc-400">20260507</code> se a tabela não existir, e <code className="text-zinc-400">20260508 + 20260510 + 20260511</code> para
                    políticas/GRANTs em <code className="text-zinc-400">admin_platform_openai</code> e <code className="text-zinc-400">ai_*</code>.
                  </p>
                ) : null}
              </div>
            ) : null}
            {credLoading && !credentials ? <div className="mt-4 h-16 animate-pulse rounded-xl bg-white/5" /> : null}
            {credentials ? (
              <ul className="mt-4 space-y-1.5 text-xs text-zinc-400">
                <li>
                  Painel Supabase:{" "}
                  <strong className={credentials.databaseConfigured ? "text-emerald-400" : "text-zinc-500"}>
                    {credentials.databaseConfigured ? "chave guardada" : "vazio"}
                  </strong>
                </li>
                <li>
                  Vercel env:{" "}
                  <strong className={credentials.envConfigured ? "text-sky-400" : "text-zinc-500"}>
                    {credentials.envConfigured ? "OPENAI_API_KEY definida" : "não"}
                  </strong>
                </li>
                <li>
                  Origem: <span className="text-zinc-200">{keySourceLabel(credentials.effectiveSource)}</span>{" "}
                  {credentials.maskedSuffix ? <code className="text-[10px] text-zinc-500">{credentials.maskedSuffix}</code> : null}
                </li>
              </ul>
            ) : null}
            <label className="mt-4 block text-[10px] font-medium uppercase tracking-wide text-zinc-500" htmlFor="omni-api-key">
              Colar nova chave
            </label>
            <Input
              id="omni-api-key"
              className="mt-1 border-white/10 bg-black/30 text-zinc-100"
              type="password"
              autoComplete="off"
              value={openAiKeyInput}
              onChange={(e) => setOpenAiKeyInput(e.target.value)}
              placeholder="sk-…"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" disabled={credSaving} onClick={() => void saveOpenAiKey()}>
                {credSaving ? "A guardar…" : "Conectar / guardar"}
              </Button>
              <Button
                variant="secondary"
                type="button"
                className="border-white/10 bg-white/5 text-zinc-200"
                disabled={testBusy}
                onClick={() => void runTestConnection()}
              >
                {testBusy ? "A testar…" : "Testar conexão"}
              </Button>
              {credentials?.databaseConfigured ? (
                <Button variant="secondary" type="button" className="border-white/10 bg-white/5" disabled={credSaving} onClick={() => void removeOpenAiKeyFromPanel()}>
                  Revogar do painel
                </Button>
              ) : null}
            </div>
            {testResult ? (
              <div
                className={cn(
                  "mt-4 rounded-xl border p-3 text-xs",
                  testResult.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" : "border-rose-500/40 bg-rose-500/10 text-rose-100",
                )}
                role="status"
              >
                <p className="font-medium">{testResult.code}</p>
                <p className="mt-1 text-[11px] opacity-90">{testResult.message}</p>
              </div>
            ) : null}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={cn(hubGlass, "space-y-4 p-5 sm:p-6 lg:col-span-7")}
          >
            <h2 className="text-sm font-semibold text-zinc-100">Estado em tempo real</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusPill ok={Boolean(runtimeOk)} label="Chave resolvida" detail={integration ? keySourceLabel(integration.openAiKeySource) : "—"} />
              <StatusPill ok={Boolean(logsOk)} label="ai_usage_logs" detail={integration?.aiUsageLogsError ?? "OK"} />
              <StatusPill ok={(integration?.requestsLast24h ?? 0) > 0} label="Pedidos 24h" detail={String(integration?.requestsLast24h ?? "0")} />
              <StatusPill ok={Boolean(integration?.lastSuccess)} label="Último sucesso" detail={integration?.lastSuccess ? `${integration.lastSuccess.tenantId} · ${integration.lastSuccess.agentId}` : "—"} />
            </div>
            <Button variant="secondary" type="button" className="w-full border-white/10 bg-white/5 text-zinc-200" disabled={verificationBusy || credSaving} onClick={() => void runSequentialVerification()}>
              {verificationBusy ? "A sincronizar…" : "Revalidar integração"}
            </Button>
          </motion.section>
        </div>

        <HubTimeseriesChart series={timeseries} />

        <HubOpenAiPanel
          openAi={openAi}
          openAiLoading={openAiLoading}
          openAiErr={openAiErr}
          lastOpenAiSync={lastOpenAiSync}
          liveSync={liveSync}
          onToggleLiveSync={() => setLiveSync((v) => !v)}
          onRefreshOpenAi={() => void loadOpenAiAccount({ force: true })}
        />

        {loadError ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
            {loadError}
          </div>
        ) : null}

        <section className={cn(hubGlass, "p-5 sm:p-6")}>
          <h2 className="text-sm font-semibold text-zinc-100">Consumo OmniChat (interno)</h2>
          <p className="mt-1 text-xs text-zinc-500">Fonte: ai_usage_logs no intervalo.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Input type="date" className="border-white/10 bg-black/30 text-zinc-100" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="border-white/10 bg-black/30 text-zinc-100" value={to} onChange={(e) => setTo(e.target.value)} />
            <Select className="border-white/10 bg-black/30 text-zinc-100" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todos</option>
              <option value="success">success</option>
              <option value="error">error</option>
              <option value="blocked">blocked</option>
              <option value="timeout">timeout</option>
            </Select>
            {loading ? <span className="text-xs text-zinc-500">A carregar…</span> : null}
          </div>
          {overviewHealth && !overviewHealth.aiUsageLogsReachable ? (
            <div className="mt-4 rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 text-xs text-rose-100">
              <p className="font-medium">ai_usage_logs inacessível</p>
              <p className="mt-1">{overviewHealth.aiUsageLogsError}</p>
              {overviewHealth.aiUsageLogsHint ? <p className="mt-2 text-amber-100/90">{overviewHealth.aiUsageLogsHint}</p> : null}
            </div>
          ) : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            <Kpi label="Tokens" v={(overview?.totalTokens ?? 0).toLocaleString("pt-BR")} />
            <Kpi label="Custo est." v={formatUsd(overview?.estimatedCostUsd ?? 0)} />
            <Kpi label="Erro %" v={`${(overview?.errorRatePct ?? 0).toFixed(1)}%`} />
            <Kpi label="p95 ms" v={`${overview?.p95LatencyMs ?? 0}`} />
            <Kpi label="Tenants" v={`${overview?.uniqueTenants ?? 0}`} />
          </div>
        </section>

        <section className={cn(hubGlass, "p-5 sm:p-6")}>
          <h2 className="text-sm font-semibold text-zinc-100">Quotas · limites (preparação billing)</h2>
          <p className="mt-1 text-xs text-zinc-500">Leitura de ai_usage_limits. Política no gateway pode ser ligada numa fase seguinte.</p>
          {limitsHint ? <p className="mt-2 text-xs text-amber-200/90">{limitsHint}</p> : null}
          {limits.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">Sem linhas activas.</p>
          ) : (
            <ul className="mt-4 max-h-48 space-y-2 overflow-auto text-xs text-zinc-400">
              {limits.map((row) => (
                <li key={row.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                  <span className="text-zinc-200">{row.tenant_id}</span>
                  {row.agent_id ? ` · ${row.agent_id}` : ""} · daily tok {row.daily_tokens_hard ?? "—"} · monthly tok {row.monthly_tokens_hard ?? "—"}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4 text-zinc-300 [&_.rounded-xl]:border-white/10 [&_th]:text-zinc-400 [&_td]:text-zinc-300">
          <div className={hubGlass}>
            <h3 className="border-b border-white/5 px-4 py-3 text-sm font-semibold text-zinc-100">Top tenants</h3>
            <DataTable columns={tenantColumns} data={tenants} rowKey={(r) => r.tenantId} />
          </div>
          <div className={hubGlass}>
            <h3 className="border-b border-white/5 px-4 py-3 text-sm font-semibold text-zinc-100">Top agentes</h3>
            <DataTable columns={agentColumns} data={agents} rowKey={(r) => `${r.tenantId}:${r.agentId}`} />
          </div>
          <div className={hubGlass}>
            <h3 className="border-b border-white/5 px-4 py-3 text-sm font-semibold text-zinc-100">Logs</h3>
            <DataTable columns={logColumns} data={logs} rowKey={(r) => r.id} />
          </div>
          <div className={cn(hubGlass, "p-4")}>
            <h3 className="text-sm font-semibold text-zinc-100">Alertas</h3>
            <div className="mt-2 space-y-2 text-xs">
              {alerts.length === 0 ? <p className="text-zinc-500">Sem alertas.</p> : null}
              {alerts.map((a, i) => (
                <pre key={i} className="overflow-auto rounded-lg bg-black/30 p-2 text-[10px] text-zinc-400">
                  {JSON.stringify(a, null, 2)}
                </pre>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StatusPill({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2", ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/10 bg-black/25")}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cn("mt-0.5 text-xs font-medium", ok ? "text-emerald-200" : "text-zinc-300")}>{ok ? "OK" : "Atenção"}</p>
      <p className="mt-1 line-clamp-2 text-[10px] text-zinc-500">{detail}</p>
    </div>
  );
}

function Kpi({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-100">{v}</p>
    </div>
  );
}
