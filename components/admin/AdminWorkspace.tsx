"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { AdminSession } from "@/lib/admin-auth";
import { getAdminDataset, type AdminDataset, type AdminRouteKey } from "@/lib/admin-data";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "@/lib/plans";
import { cn, formatBRL } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { AdminCouponsWorkspace } from "@/components/admin/commercial/AdminCouponsWorkspace";
import { AdminPartnersHub } from "@/components/admin/commercial/AdminPartnersHub";
import { MaintenanceModePanel } from "@/components/admin/MaintenanceModePanel";
import { AdminEnterpriseWorkspace } from "@/components/admin/enterprise/AdminEnterpriseWorkspace";
import { AdminAiControlCenter } from "@/components/admin/ai/AdminAiControlCenter";
import {
  StripeChurnPage,
  StripeFinanceiroPage,
  StripeFaturasPage,
  StripePagamentosPage,
} from "@/components/admin/stripe/AdminStripeFinancePages";

const PlatformIntelligenceDashboard = dynamic(
  () =>
    import("@/components/admin/platform/PlatformIntelligenceDashboard").then((m) => ({
      default: m.PlatformIntelligenceDashboard,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className={cn(
          "flex min-h-[280px] items-center justify-center rounded-xl border border-line",
          "bg-surface-card/80 text-sm text-content-muted",
        )}
      >
        A carregar inteligência da plataforma…
      </div>
    ),
  },
);

function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel-surface-card min-w-0 rounded-xl border border-line bg-surface-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-content sm:text-xl">{title}</h2>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="panel-surface-card panel-kpi-card rounded-xl border border-line bg-surface-card p-4">
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-content">{value}</p>
      <p className="mt-2 text-xs text-content-faint">{helper}</p>
    </div>
  );
}

function Bars({ items }: { items: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-content-secondary">{item.label}</span>
            <span className="text-content-faint">{item.value}%</span>
          </div>
          <div className="h-3 rounded-full bg-line/40">
            <div className={cn("h-3 rounded-full bg-primary", item.color)} style={{ width: `${item.value}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

type PlatformMetricsKpis = {
  messagesProcessed: number;
  tokensConsumed: number;
  workspacesRegistered: number;
  workspacesActiveInPeriod: number;
  agentsTotal: number;
  revenueTotalBrl: number;
  costTotalBrl: number;
  growthVsPreviousPct: number | null;
};

function AnalyticsPage({ dataset }: { dataset: ReturnType<typeof getAdminDataset> }) {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const [metrics, setMetrics] = useState<PlatformMetricsKpis | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
        const to = new Date();
        const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString(),
        });
        const res = await fetch(`/api/admin/platform-metrics?${params}`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 403) {
            setMetricsError("Sem permissão para visualizar métricas da plataforma.");
          } else {
            setMetricsError("Falha ao carregar métricas. Tente novamente.");
          }
          return;
        }
        const data = await res.json();
        setMetrics(data.kpis ?? null);
      } catch {
        if (!cancelled) setMetricsError("Erro de conexão ao carregar métricas.");
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [period]);

  const kpiStats = metrics ? [
    { label: "Mensagens processadas", value: metrics.messagesProcessed.toLocaleString("pt-BR"), helper: `${period === "7d" ? "7" : period === "30d" ? "30" : period === "90d" ? "90" : "365"} dias` },
    { label: "Tokens consumidos", value: metrics.tokensConsumed.toLocaleString("pt-BR"), helper: "Total no período" },
    { label: "Clientes ativos", value: metrics.workspacesActiveInPeriod.toString(), helper: `de ${metrics.workspacesRegistered} registados` },
    { label: "Agentes configurados", value: metrics.agentsTotal.toString(), helper: metrics.growthVsPreviousPct !== null ? `${metrics.growthVsPreviousPct > 0 ? "+" : ""}${metrics.growthVsPreviousPct}% vs período anterior` : "–" },
  ] : dataset.analyticsStats;

  return (
    <div className="space-y-6">
      <Panel
        title="Filtros e visão analítica"
        actions={
          <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="90d">90 dias</option>
            <option value="12m">12 meses</option>
          </Select>
        }
      >
        {metricsError ? (
          <p className="mb-3 text-sm text-rose-400">{metricsError}</p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metricsLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-surface-elevated/50" />
              ))
            : kpiStats.map((item) => (
                <Stat key={item.label} {...item} />
              ))}
        </div>
      </Panel>
      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Aquisicao"><Bars items={dataset.acquisitionBars} /></Panel>
        <Panel title="Retencao"><Bars items={dataset.retentionBars} /></Panel>
        <Panel title="Receita"><Bars items={dataset.revenueBars} /></Panel>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Performance de Agentes">
          <div className="space-y-3">
            {dataset.topAgents.map((agent) => (
              <div key={agent.nome} className="flex items-center justify-between rounded-xl border border-line bg-surface-card p-3 text-sm">
                <div>
                  <p className="font-medium text-content">{agent.nome}</p>
                  <p className="text-xs text-content-faint">
                    {agent.cliente} · origem principal: {agent.origemPrincipal}
                  </p>
                </div>
                <Badge className="border-primary/30 bg-primary/10 text-primary">{agent.conversasDia} conv/dia</Badge>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Adoção de multiagentes">
          <div className="space-y-4">
            <div>
              <p className={cn(typography.ui.overline, "text-content-faint")}>Distribuição por cliente</p>
              <ul className="mt-2 space-y-2 text-sm text-content-secondary">
                {dataset.agentDistribution.map((item) => (
                  <li key={item.faixa} className="flex items-center justify-between">
                    <span>{item.faixa}</span>
                    <span>{item.totalClientes} clientes</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className={cn(typography.ui.overline, "text-content-faint")}>Origem mais usada</p>
              <ul className="mt-2 space-y-2 text-sm text-content-secondary">
                {dataset.agentOriginShare.map((item) => (
                  <li key={item.origem} className="flex items-center justify-between">
                    <span>{item.origem}</span>
                    <span>{item.percentual}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Conversas por agente por dia">
        <div className="space-y-3">
          {dataset.agentConversationsDaily.map((row) => (
            <div key={row.dia} className="rounded-xl border border-line bg-surface-card p-3">
              <div className="mb-2 flex items-center justify-between text-sm text-content-secondary">
                <span>{row.dia}</span>
                <span>{row.mariana + row.carlos + row.verao} total</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.min(100, row.mariana)}%` }} />
                <div className="h-2 rounded-full bg-primary-hover/85" style={{ width: `${Math.min(100, row.carlos)}%` }} />
                <div className="h-2 rounded-full bg-amber-500/80" style={{ width: `${Math.min(100, row.verao)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

type RealClient = {
  id: string;
  name: string;
  email: string;
  planSlug: string;
  status: string;
  createdAt: string;
  stripeCustomerId: string | null;
};

function ClientsPage() {
  const [clients, setClients] = useState<RealClient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlan, setFilterPlan] = useState("all");
  const [active, setActive] = useState<RealClient | null>(null);

  const fetchClients = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterPlan !== "all") params.set("plan", filterPlan);
    return params.toString();
  }, [search, filterStatus, filterPlan]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/admin/clients?${fetchClients}`);
        if (cancelled) return;
        if (!res.ok) {
          setLoadError("Falha ao carregar clientes. Tente novamente.");
          return;
        }
        const data = await res.json();
        setClients(data.clients ?? []);
        setTotal(data.total ?? 0);
      } catch {
        if (!cancelled) setLoadError("Erro de conexão ao carregar clientes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [fetchClients]);

  function exportCsv() {
    if (!clients.length) return;
    const headers = ["ID", "Nome", "Email", "Plano", "Status", "Criado em"];
    const rows = clients.map((c) => [c.id, c.name, c.email, c.planSlug, c.status, c.createdAt]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns: Column<RealClient>[] = [
    { key: "name", header: "Nome", render: (row) => row.name || "—" },
    { key: "email", header: "Email", render: (row) => row.email || "—" },
    { key: "planSlug", header: "Plano", render: (row) => row.planSlug || "—" },
    { key: "status", header: "Status", render: (row) => row.status },
    { key: "createdAt", header: "Criado em", render: (row) => new Date(row.createdAt).toLocaleDateString("pt-BR") },
  ];

  return (
    <div className="space-y-6">
      <Panel title="Base completa de clientes" description="Visão master dos tenants registados.">
        {loadError ? <p className="mb-3 text-sm text-rose-400">{loadError}</p> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            placeholder="Buscar nome ou email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={filterPlan} onChange={(e) => setFilterPlan(e.target.value)}>
            <option value="all">Todos os planos</option>
            <option value="profissional">Profissional</option>
            <option value="master">Master</option>
            <option value="enterprise">Enterprise</option>
            <option value="trial">Trial</option>
          </Select>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="suspended">Suspenso</option>
            <option value="cancelled">Cancelado</option>
          </Select>
          <div />
          <Button variant="secondary" onClick={exportCsv} disabled={loading || !clients.length}>
            Exportar CSV
          </Button>
        </div>
        {!loadError && <p className="mt-2 text-xs text-content-faint">{loading ? "Carregando..." : `${total} cliente${total !== 1 ? "s" : ""} encontrado${total !== 1 ? "s" : ""}`}</p>}
      </Panel>
      <Panel title="Tabela master">
        {loading
          ? <div className="h-40 animate-pulse rounded-xl bg-surface-elevated/50" />
          : <DataTable columns={columns} data={clients} rowKey={(row) => row.id} onRowClick={setActive} />}
      </Panel>
      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.name ?? "Cliente"}
        className="max-w-2xl"
        footer={<Button variant="secondary" onClick={() => setActive(null)}>Fechar</Button>}
      >
        {active ? (
          <div className="space-y-4 text-sm text-content-secondary">
            <div className="rounded-xl border border-line bg-surface-deep p-4">
              <p><span className="font-medium text-content">ID:</span> {active.id}</p>
              <p><span className="font-medium text-content">Email:</span> {active.email}</p>
              <p><span className="font-medium text-content">Plano:</span> {active.planSlug || "—"}</p>
              <p><span className="font-medium text-content">Status:</span> {active.status}</p>
              <p><span className="font-medium text-content">Criado em:</span> {new Date(active.createdAt).toLocaleString("pt-BR")}</p>
              {active.stripeCustomerId && (
                <p><span className="font-medium text-content">Stripe Customer:</span> {active.stripeCustomerId}</p>
              )}
            </div>
            <p className="text-xs text-content-faint">
              Ações avançadas (trocar plano, suspender, etc.) estão em desenvolvimento.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

type PlanConfigData = {
  planSlug: string;
  agentLimit: number;
  followupLimit: number;
  keywordLimit: number;
  features: { lead_ads: boolean; click_to_whatsapp: boolean; qr_codes: boolean; followup_auto: boolean };
};

function PlanEditor({ config, onChange }: { config: PlanConfigData; onChange: (c: PlanConfigData) => void }) {
  const label: Record<string, string> = {
    profissional: "Plano Profissional",
    master: "Plano Master",
  };
  const setFeat = (key: keyof PlanConfigData["features"], val: boolean) =>
    onChange({ ...config, features: { ...config.features, [key]: val } });
  return (
    <div className="rounded-xl border border-line bg-surface-card p-4">
      <p className="text-sm font-semibold text-content">{label[config.planSlug] ?? config.planSlug}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Input
          type="number"
          value={config.agentLimit}
          placeholder="Limite de agentes"
          onChange={(e) => onChange({ ...config, agentLimit: Math.max(1, Number(e.target.value) || 1) })}
        />
        <Input
          type="number"
          value={config.followupLimit}
          placeholder="Limite de follow-ups"
          onChange={(e) => onChange({ ...config, followupLimit: Math.max(1, Number(e.target.value) || 1) })}
        />
        <Input
          type="number"
          value={config.keywordLimit}
          placeholder="Limite de keywords"
          onChange={(e) => onChange({ ...config, keywordLimit: Math.max(1, Number(e.target.value) || 1) })}
        />
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <Toggle id={`${config.planSlug}-lead-ads`} checked={config.features.lead_ads} onChange={(v) => setFeat("lead_ads", v)} label="Pode usar Lead Ads?" />
        <Toggle id={`${config.planSlug}-ctw`} checked={config.features.click_to_whatsapp} onChange={(v) => setFeat("click_to_whatsapp", v)} label="Pode usar Click to WhatsApp?" />
        <Toggle id={`${config.planSlug}-qr`} checked={config.features.qr_codes} onChange={(v) => setFeat("qr_codes", v)} label="Pode gerar QR Codes?" />
        <Toggle id={`${config.planSlug}-follow`} checked={config.features.followup_auto} onChange={(v) => setFeat("followup_auto", v)} label="Pode usar follow-up automático?" />
      </div>
    </div>
  );
}

function PlansPage() {
  const [plans, setPlans] = useState<PlanConfigData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/admin/plan-config")
      .then((res) => {
        if (!res.ok) { setLoadError("Falha ao carregar configuração."); return null; }
        return res.json();
      })
      .then((data) => {
        if (data) setPlans(data.plans ?? []);
      })
      .catch(() => setLoadError("Erro de conexão."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const results = await Promise.all(
        plans.map((plan) =>
          fetch("/api/admin/plan-config", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(plan),
          }).then((r) => r.json()),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed) { setSaveError(failed.error); return; }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError("Erro de conexão ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Planos e limites de multiagentes"
        description={`Defina capacidades por plano. WhatsApp: 1 número em todos os planos; cada adicional +${formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês.`}
      >
        {loadError ? <p className="mb-3 text-sm text-rose-400">{loadError}</p> : null}
        {loading ? (
          <div className="space-y-4">
            <div className="h-36 animate-pulse rounded-xl bg-surface-elevated/50" />
            <div className="h-36 animate-pulse rounded-xl bg-surface-elevated/50" />
          </div>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => (
              <PlanEditor
                key={plan.planSlug}
                config={plan}
                onChange={(updated) => setPlans((prev) => prev.map((p) => (p.planSlug === updated.planSlug ? updated : p)))}
              />
            ))}
            {saveError ? <p className="text-sm text-rose-400">{saveError}</p> : null}
            {saveSuccess ? <p className="text-sm text-emerald-400">Configuração salva com sucesso!</p> : null}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving || loading}>
                {saving ? "Salvando..." : "Salvar limites de planos"}
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

type LogEntry = { id: string; type: string; level: string; message: string; actor: string; createdAt: string };

function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams({ type: filterType, pageSize: "100" });
        const res = await fetch(`/api/admin/logs?${params}`);
        if (cancelled) return;
        if (!res.ok) { setLoadError("Falha ao carregar logs."); return; }
        const data = await res.json();
        setLogs(data.logs ?? []);
      } catch {
        if (!cancelled) setLoadError("Erro de conexão.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [filterType]);

  const levelColor: Record<string, string> = {
    error: "text-rose-400",
    warn: "text-amber-400",
    info: "text-content-secondary",
  };

  const columns: Column<LogEntry>[] = [
    { key: "createdAt", header: "Data", render: (r) => new Date(r.createdAt).toLocaleString("pt-BR") },
    { key: "level", header: "Nível", render: (r) => <span className={levelColor[r.level] ?? ""}>{r.level.toUpperCase()}</span> },
    { key: "type", header: "Tipo", render: (r) => r.type },
    { key: "actor", header: "Actor", render: (r) => r.actor || "—" },
    { key: "message", header: "Mensagem", render: (r) => r.message },
  ];

  return (
    <Panel
      title="Logs do sistema"
      description="Ações comerciais, erros de IA e eventos de auditoria."
      actions={
        <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="all">Todos os tipos</option>
          <option value="comercial">Comercial</option>
          <option value="ia">IA</option>
        </Select>
      }
    >
      {loadError ? <p className="mb-3 text-sm text-rose-400">{loadError}</p> : null}
      {loading
        ? <div className="h-40 animate-pulse rounded-xl bg-surface-elevated/50" />
        : logs.length === 0
          ? <p className="text-sm text-content-faint">Nenhum log encontrado no filtro selecionado.</p>
          : <DataTable columns={columns} data={logs} rowKey={(r) => r.id} />}
    </Panel>
  );
}

function ComingSoonPage({ title, description, nextStep }: { title: string; description: string; nextStep?: string }) {
  return (
    <Panel title={title} description={description}>
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="rounded-full border border-line bg-surface-elevated p-4">
          <svg className="h-8 w-8 text-content-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
          </svg>
        </div>
        <div>
          <p className="font-medium text-content">Esta seção está em desenvolvimento</p>
          <p className="mt-1 max-w-sm text-sm text-content-faint">{description}</p>
          {nextStep ? (
            <p className="mt-3 text-xs text-content-faint">
              Próximo passo: {nextStep}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function ConfigPage() {
  return (
    <div className="space-y-6">
      <MaintenanceModePanel />
      <ComingSoonPage
        title="Configurações avançadas"
        description="Configurações globais de empresa, WhatsApp, pagamentos, email e integrações externas serão centralizadas aqui."
        nextStep="Mapear cada configuração com a sua tabela ou variável de ambiente correspondente."
      />
    </div>
  );
}

type AdminMember = {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  role: string;
  roleLabel: string;
  active: boolean;
  createdAt: string;
  lastActivity: string | null;
};

function TeamPage() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("admin");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const loadMembers = () => {
    setLoading(true);
    setLoadError(null);
    fetch("/api/admin/team")
      .then((res) => {
        if (!res.ok) {
          if (res.status === 403) setLoadError("Sem permissão para visualizar a equipe.");
          else setLoadError("Falha ao carregar equipe.");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setMembers(data.members ?? []);
      })
      .catch(() => setLoadError("Erro de conexão."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadMembers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setInviteError("Preencha nome e email.");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: inviteName, email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error ?? "Falha ao criar membro.");
        return;
      }
      setInviteSuccess(`Membro criado. Senha temporária: ${data.tempPassword} (anote e envie por canal seguro)`);
      setInviteName("");
      setInviteEmail("");
      loadMembers();
    } catch {
      setInviteError("Erro de conexão.");
    } finally {
      setInviting(false);
    }
  }

  const columns: Column<AdminMember>[] = [
    { key: "displayName", header: "Nome", render: (r) => r.displayName },
    { key: "email", header: "Email", render: (r) => r.email },
    { key: "roleLabel", header: "Role", render: (r) => r.roleLabel },
    { key: "active", header: "Status", render: (r) => (r.active ? "Ativo" : "Inativo") },
    { key: "createdAt", header: "Desde", render: (r) => new Date(r.createdAt).toLocaleDateString("pt-BR") },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
      <Panel title="Colaboradores" description="Roles, status de acesso e últimas atividades.">
        {loadError ? <p className="mb-3 text-sm text-rose-400">{loadError}</p> : null}
        {loading
          ? <div className="h-40 animate-pulse rounded-xl bg-surface-elevated/50" />
          : <DataTable columns={columns} data={members} rowKey={(r) => r.id} />}
      </Panel>
      <Panel title="Adicionar colaborador">
        <form onSubmit={handleInvite} className="space-y-3">
          <Input placeholder="Nome" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
          <Input type="email" placeholder="Email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="financeiro">Financeiro</option>
            <option value="suporte">Suporte</option>
            <option value="marketing">Marketing</option>
            <option value="desenvolvedor">Desenvolvedor</option>
          </Select>
          {inviteError ? <p className="text-sm text-rose-400">{inviteError}</p> : null}
          {inviteSuccess ? <p className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-400">{inviteSuccess}</p> : null}
          <Button type="submit" disabled={inviting}>{inviting ? "Criando..." : "Criar membro"}</Button>
        </form>
        <p className="mt-2 text-xs text-content-faint">Apenas Super Admin pode criar membros da equipe.</p>
      </Panel>
    </div>
  );
}

function SecurityPage() {
  const [ipWhitelist, setIpWhitelist] = useState(false);
  const [blockOffHours, setBlockOffHours] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/security-config")
      .then((res) => {
        if (!res.ok) { setConfigError("Falha ao carregar configurações."); return null; }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setIpWhitelist(Boolean(data.ipWhitelistEnabled));
          setBlockOffHours(Boolean(data.blockOffHours));
          setConfigLoaded(true);
        }
      })
      .catch(() => setConfigError("Erro de conexão."));
  }, []);

  async function saveToggle(field: "ipWhitelistEnabled" | "blockOffHours", value: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/security-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) setConfigError("Falha ao salvar.");
    } catch {
      setConfigError("Erro de conexão ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <MaintenanceModePanel />
      <Panel title="Políticas e bloqueios">
        {configError ? <p className="mb-3 text-sm text-rose-400">{configError}</p> : null}
        {!configLoaded && !configError ? (
          <div className="h-24 animate-pulse rounded-xl bg-surface-elevated/50" />
        ) : (
          <div className="space-y-3">
            <Toggle
              id="whitelist"
              checked={ipWhitelist}
              onChange={(v) => { setIpWhitelist(v); void saveToggle("ipWhitelistEnabled", v); }}
              label="Whitelist de IP"
              description={saving ? "Salvando..." : "Ative para restringir acesso ao /admin por IP."}
            />
            <Toggle
              id="schedule"
              checked={blockOffHours}
              onChange={(v) => { setBlockOffHours(v); void saveToggle("blockOffHours", v); }}
              label="Bloquear fora do horário comercial"
            />
            <Toggle
              id="totp"
              checked={false}
              onChange={() => undefined}
              label="2FA para admin (em breve)"
              description="Funcionalidade em desenvolvimento."
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

export function AdminWorkspace({
  routeKey,
  session,
  serverDataset,
}: {
  routeKey: AdminRouteKey;
  session: AdminSession;
  serverDataset?: AdminDataset;
}) {
  const { isLight } = usePanelAppearance();
  const computedDataset = useMemo(() => getAdminDataset(session), [session]);
  const dataset = serverDataset ?? computedDataset;
  const content = useMemo(() => {
    switch (routeKey) {
      case "dashboard":
        return <PlatformIntelligenceDashboard session={session} />;
      case "analytics":
        return <AnalyticsPage dataset={dataset} />;
      case "clientes":
        return <ClientsPage />;
      case "leads":
        return (
          <ComingSoonPage
            title="Leads captados pelo chatbot"
            description="Origem, responsável, etapa do funil e conversão em cliente. Requer integração com o CRM e tracking de UTMs."
            nextStep="Conectar tabela de leads ao pipeline de conversão."
          />
        );
      case "inadimplentes":
        return (
          <ComingSoonPage
            title="Clientes inadimplentes"
            description="Fluxo de cobrança, automações D+1/D+3/D+7 e negociações. Requer integração com Stripe."
            nextStep="Conectar Stripe para detectar faturas em atraso."
          />
        );
      case "cancelamentos":
        return (
          <ComingSoonPage
            title="Cancelamentos"
            description="Motivos de cancelamento, MRR perdido e ações de retenção. Requer integração com Stripe."
            nextStep="Conectar eventos de cancelamento do Stripe."
          />
        );
      case "planos":
        return <PlansPage />;
      case "enterprise":
        return <AdminEnterpriseWorkspace />;
      case "cupons":
        return <AdminCouponsWorkspace />;
      case "parcerias":
        return <AdminPartnersHub />;
      case "features":
        return (
          <ComingSoonPage
            title="Feature flags"
            description="Ative ou desative recursos por plano ou por cliente específico. Requer implementação de um sistema de flags."
            nextStep="Implementar tabela de feature_flags com override por tenant."
          />
        );
      case "financeiro":
        return <StripeFinanceiroPage />;
      case "faturas":
        return <StripeFaturasPage />;
      case "pagamentos":
        return <StripePagamentosPage />;
      case "churn":
        return <StripeChurnPage />;
      case "suporte":
        return (
          <ComingSoonPage
            title="Central de suporte"
            description="Tickets, SLA, prioridade e templates de resposta. Requer sistema de tickets integrado."
            nextStep="Integrar Intercom, Zendesk ou criar tabela de tickets interna."
          />
        );
      case "comunicados":
        return (
          <ComingSoonPage
            title="Comunicados"
            description="Banner no dashboard do cliente, email e agenda de manutenção. Requer sistema de notificações."
            nextStep="Implementar tabela de comunicados com envio via Resend."
          />
        );
      case "notificacoes":
        return (
          <ComingSoonPage
            title="Templates de notificações"
            description="Sequências para clientes e alertas internos da equipe. Requer sistema de templates de email."
            nextStep="Criar tabela de notification_templates com preview e envio via Resend."
          />
        );
      case "configuracoes":
        return <ConfigPage />;
      case "ia":
        return <AdminAiControlCenter />;
      case "equipe":
        return <TeamPage />;
      case "apis":
        return (
          <ComingSoonPage
            title="APIs e webhooks"
            description="Chaves de API, eventos, quotas e documentação interna. Requer implementação de gestão de API keys."
            nextStep="Implementar tabela api_keys com scopes e rate limiting."
          />
        );
      case "logs":
        return <LogsPage />;
      case "seguranca":
        return <SecurityPage />;
      default:
        return <PlatformIntelligenceDashboard session={session} />;
    }
  }, [routeKey, dataset, session]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          className={cn(
            isLight ? "border-primary/30 bg-primary/[0.1] text-content" : "border-primary/30 bg-primary/10 text-content",
          )}
        >
          {session.roleLabel}
        </Badge>
        <span className="text-sm text-content-muted">Sessao ativa para {session.displayName}</span>
      </div>
      {content}
    </div>
  );
}
