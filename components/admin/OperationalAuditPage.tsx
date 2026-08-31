"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { cn } from "@/lib/utils";

type AuditEvent = {
  id: string; operation_id: string; trace_id: string; occurred_at: string;
  tenant_id: string | null; actor_type: string; actor_id: string | null;
  module: string; action: string; resource_type: string | null; resource_id: string | null;
  status: string; severity: string; is_critical: boolean; channel: string | null;
  integration: string | null; duration_ms: number | null; attempt: number;
  result_code: string | null; related_ids: Record<string, unknown>; metadata: Record<string, unknown>;
  deployment_sha: string | null;
};

type Dashboard = {
  total?: number; success?: number; errors?: number; blocked?: number;
  cancelled?: number; running?: number; critical?: number; averageDurationMs?: number;
  watchdogLastObservedAt?: string | null; productionSha?: string | null;
};

type Filters = {
  from: string; to: string; tenant_id: string; actor_id: string; module: string;
  action: string; resource_id: string; status: string; severity: string;
  resource_type: string; operation_id: string;
  actor_type: string; channel: string; integration: string; trace_id: string;
  critical: boolean; slow: boolean; running: boolean;
};

function dateTimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialFilters(): Filters {
  const now = new Date();
  return {
    from: dateTimeLocal(new Date(now.getTime() - 24 * 60 * 60_000)), to: dateTimeLocal(now),
    tenant_id: "", actor_id: "", module: "", action: "", resource_id: "",
    status: "", severity: "", actor_type: "", channel: "", integration: "", trace_id: "",
    resource_type: "", operation_id: "",
    critical: false, slow: false, running: false,
  };
}

const statusClass: Record<string, string> = {
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  error: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  blocked: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  cancelled: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  running: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  pending: "border-violet-500/30 bg-violet-500/10 text-violet-300",
};

export function OperationalAuditPage() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [nextCursor, setNextCursor] = useState<{ occurredAt: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<AuditEvent[] | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const paramsFor = useCallback((source: Filters, cursor?: { occurredAt: string; id: string } | null) => {
    const params = new URLSearchParams({
      from: new Date(source.from).toISOString(), to: new Date(source.to).toISOString(), limit: "50",
    });
    for (const key of ["tenant_id", "actor_id", "module", "action", "resource_type", "resource_id", "status", "severity", "actor_type", "channel", "integration", "trace_id", "operation_id"] as const) {
      if (source[key]) params.set(key, source[key]);
    }
    if (source.critical) params.set("critical", "true");
    if (source.slow) params.set("slow", "true");
    if (source.running) params.set("running", "true");
    if (cursor) { params.set("cursor_at", cursor.occurredAt); params.set("cursor_id", cursor.id); }
    return params;
  }, []);

  const load = useCallback(async (append = false, cursor: { occurredAt: string; id: string } | null = null, background = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!background) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/operational-audit?${paramsFor(applied, append ? cursor : null)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "Esta área é exclusiva do proprietário." : "Falha ao carregar a auditoria.");
      const data = await response.json();
      setEvents((current) => append ? [...current, ...(data.events ?? [])] : data.events ?? []);
      setDashboard(data.dashboard ?? {}); setNextCursor(data.nextCursor ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar a auditoria.");
    } finally {
      loadingRef.current = false;
      if (!background) setLoading(false);
    }
  }, [applied, paramsFor]);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false, null, true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const cards = useMemo(() => [
    ["Operações", dashboard.total ?? 0], ["Sucessos", dashboard.success ?? 0],
    ["Falhas", dashboard.errors ?? 0], ["Bloqueios", dashboard.blocked ?? 0],
    ["Em execução", dashboard.running ?? 0], ["Críticos", dashboard.critical ?? 0],
    ["Latência média", `${dashboard.averageDurationMs ?? 0} ms`],
    ["Watchdog", dashboard.watchdogLastObservedAt ? "Ativo" : "Sem leitura"],
    ["SHA", dashboard.productionSha?.slice(0, 8) ?? "—"],
  ], [dashboard]);

  async function showTrace(traceId: string) {
    setTraceEvents(null); setExpanded(`trace:${traceId}`);
    const response = await fetch(`/api/admin/operational-audit/traces/${traceId}`, { cache: "no-store" });
    const data = response.ok ? await response.json() : { events: [] };
    setTraceEvents(data.events ?? []);
  }

  async function createExport(format: "csv" | "json" | "ndjson") {
    setExporting(format); setError(null);
    try {
      const exportFilters = Object.fromEntries(Object.entries(applied).filter(([key, value]) => !["from", "to", "slow", "running"].includes(key) && value));
      const response = await fetch("/api/admin/operational-audit/exports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, from: new Date(applied.from).toISOString(), to: new Date(applied.to).toISOString(), filters: exportFilters }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao criar exportação.");
      const id = data.export.id as string;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const statusResponse = await fetch(`/api/admin/operational-audit/exports/${id}`, { cache: "no-store" });
        const statusData = await statusResponse.json();
        if (statusData.export?.downloadUrl) { window.location.assign(statusData.export.downloadUrl); return; }
        if (statusData.export?.status === "failed") throw new Error("A exportação falhou.");
      }
      throw new Error("A exportação ainda está sendo processada. Tente novamente em instantes.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na exportação."); }
    finally { setExporting(null); }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h1 className="text-xl font-semibold text-content">Auditoria operacional</h1><p className="mt-1 text-sm text-content-muted">Trajetória completa e sanitizada de ações materiais do MyChatCRM.</p></div>
          <div className="flex flex-wrap gap-2">
            {(["csv", "json", "ndjson"] as const).map((format) => <Button key={format} onClick={() => void createExport(format)} disabled={Boolean(exporting)}>Exportar {format.toUpperCase()}</Button>)}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {cards.map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-surface-elevated/40 p-3"><p className="text-xs text-content-muted">{label}</p><p className="mt-1 text-lg font-semibold text-content">{value}</p></div>)}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} aria-label="Data inicial" />
          <Input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} aria-label="Data final" />
          <Input aria-label="Tenant" placeholder="Tenant" value={filters.tenant_id} onChange={(event) => setFilters({ ...filters, tenant_id: event.target.value })} />
          <Input aria-label="Módulo" placeholder="Módulo" value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} />
          <Input aria-label="Ação" placeholder="Ação" value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} />
          <Input aria-label="Agente ou usuário" placeholder="Agente/usuário" value={filters.actor_id} onChange={(event) => setFilters({ ...filters, actor_id: event.target.value })} />
          <Input aria-label="Tipo de recurso" placeholder="Tipo de recurso" value={filters.resource_type} onChange={(event) => setFilters({ ...filters, resource_type: event.target.value })} />
          <Input aria-label="Identificador do recurso" placeholder="Lead, conversa, job ou recurso" value={filters.resource_id} onChange={(event) => setFilters({ ...filters, resource_id: event.target.value })} />
          <Input aria-label="Trace ID" placeholder="traceId" value={filters.trace_id} onChange={(event) => setFilters({ ...filters, trace_id: event.target.value })} />
          <Input aria-label="Operation ID" placeholder="operationId" value={filters.operation_id} onChange={(event) => setFilters({ ...filters, operation_id: event.target.value })} />
          <Input aria-label="Canal" placeholder="Canal" value={filters.channel} onChange={(event) => setFilters({ ...filters, channel: event.target.value })} />
          <Input aria-label="Integração" placeholder="Integração" value={filters.integration} onChange={(event) => setFilters({ ...filters, integration: event.target.value })} />
          <Select aria-label="Tipo do responsável" value={filters.actor_type} onChange={(event) => setFilters({ ...filters, actor_type: event.target.value })}><option value="">Todos os responsáveis</option>{["customer", "administrator", "agent", "system", "webhook", "cron", "worker", "external_integration"].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
          <Select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos os status</option>{["pending", "running", "completed", "blocked", "cancelled", "error"].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
          <Select aria-label="Severidade" value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">Todas as severidades</option>{["debug", "info", "warning", "error", "critical"].map((value) => <option key={value} value={value}>{value}</option>)}</Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-content-secondary">
          {[(["critical", "Somente críticos"]), (["slow", "Operações lentas"]), (["running", "Em andamento"])] .map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={filters[key as "critical" | "slow" | "running"]} onChange={(event) => setFilters({ ...filters, [key]: event.target.checked })} />{label}</label>)}
          <Button onClick={() => setApplied({ ...filters })}>Aplicar filtros</Button>
          <Button onClick={() => { const reset = initialFilters(); setFilters(reset); setApplied(reset); }}>Limpar</Button>
          <span className="ml-auto text-xs text-content-faint">Atualização automática a cada 5 segundos</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface-card">
        {error ? <p className="m-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p> : null}
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b border-line bg-surface-elevated/40 text-xs uppercase text-content-muted"><tr>{["Horário", "Status", "Responsável", "Módulo / ação", "Recurso", "Duração", "Resultado", "Trace"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>
          {events.map((event) => <tr key={event.id} className="border-b border-line/60 align-top hover:bg-surface-elevated/30">
            <td className="whitespace-nowrap px-4 py-3 text-content-secondary">{new Date(event.occurred_at).toLocaleString()}</td>
            <td className="px-4 py-3"><span className={cn("rounded-full border px-2 py-1 text-xs", statusClass[event.status])}>{event.status}</span>{event.is_critical ? <span className="ml-1 text-rose-400">●</span> : null}</td>
            <td className="px-4 py-3 text-content-secondary"><div>{event.actor_type}</div><div className="max-w-40 truncate text-xs text-content-faint">{event.actor_id ?? "—"}</div></td>
            <td className="px-4 py-3"><div className="font-medium text-content">{event.module}</div><button onClick={() => setExpanded(expanded === event.id ? null : event.id)} className="text-left text-xs text-primary hover:underline">{event.action}</button></td>
            <td className="px-4 py-3 text-content-secondary"><div>{event.resource_type ?? "—"}</div><div className="max-w-52 truncate text-xs text-content-faint">{event.resource_id ?? "—"}</div></td>
            <td className="px-4 py-3 text-content-secondary">{event.duration_ms == null ? "—" : `${event.duration_ms} ms`}</td>
            <td className="px-4 py-3 text-content-secondary">{event.result_code ?? "—"}</td>
            <td className="px-4 py-3"><button onClick={() => void showTrace(event.trace_id)} className="max-w-32 truncate text-primary hover:underline">{event.trace_id}</button></td>
          </tr>)}
        </tbody></table></div>
        {!events.length && !loading ? <p className="p-8 text-center text-sm text-content-faint">Nenhum evento encontrado.</p> : null}
        {loading ? <p className="p-4 text-center text-sm text-content-muted">Carregando…</p> : null}
        {nextCursor && !loading ? <div className="p-4 text-center"><Button onClick={() => void load(true, nextCursor)}>Carregar mais</Button></div> : null}
      </section>

      {expanded && expanded.startsWith("trace:") ? <section className="rounded-xl border border-line bg-surface-card p-5"><div className="flex justify-between"><h2 className="font-semibold text-content">Timeline da operação</h2><button onClick={() => setExpanded(null)} className="text-content-muted">Fechar</button></div><div className="mt-4 space-y-3">{traceEvents?.map((event) => <div key={event.id} className="border-l-2 border-primary/40 pl-4"><p className="text-sm font-medium text-content">{event.module} · {event.action}</p><p className="text-xs text-content-muted">{new Date(event.occurred_at).toLocaleString()} · {event.status} · {event.result_code ?? "sem código"}</p></div>) ?? <p className="text-sm text-content-muted">Carregando trajetória…</p>}</div></section> : null}
      {expanded && !expanded.startsWith("trace:") ? <section className="rounded-xl border border-line bg-surface-card p-5"><div className="flex justify-between"><h2 className="font-semibold text-content">Detalhes sanitizados</h2><button onClick={() => setExpanded(null)} className="text-content-muted">Fechar</button></div><pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black/20 p-4 text-xs text-content-secondary">{JSON.stringify(events.find((event) => event.id === expanded), null, 2)}</pre></section> : null}
    </div>
  );
}
