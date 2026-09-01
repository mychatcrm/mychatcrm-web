"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Modal } from "@/components/ui/Modal";
import {
  auditActorLabel,
  auditSeverityLabel,
  auditStatusLabel,
  explainOperationalAuditEvent,
} from "@/lib/operational-audit-explanations";
import { cn } from "@/lib/utils";

type AuditEvent = {
  id: string; operation_id: string; trace_id: string; span_id?: string | null;
  parent_span_id?: string | null; occurred_at: string;
  tenant_id: string | null; actor_type: string; actor_id: string | null;
  module: string; action: string; resource_type: string | null; resource_id: string | null;
  status: string; severity: string; is_critical: boolean; channel: string | null;
  integration: string | null; duration_ms: number | null; attempt: number;
  idempotency_key?: string | null;
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

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-lg border border-line/70 bg-surface-elevated/30 p-3"><dt className="text-xs font-medium uppercase tracking-wide text-content-faint">{label}</dt><dd className={cn("mt-1 break-words text-sm text-content-secondary", mono && "font-mono text-xs")}>{value}</dd></div>;
}

function AuditEventDetailsModal({
  event,
  onClose,
  onShowTrace,
}: {
  event: AuditEvent | null;
  onClose: () => void;
  onShowTrace: (traceId: string) => void;
}) {
  if (!event) return null;
  const explanation = explainOperationalAuditEvent(event);
  const technicalDetails = {
    id: event.id,
    operationId: event.operation_id,
    traceId: event.trace_id,
    spanId: event.span_id ?? null,
    parentSpanId: event.parent_span_id ?? null,
    tenantId: event.tenant_id,
    actorType: event.actor_type,
    actorId: event.actor_id,
    module: event.module,
    action: event.action,
    resourceType: event.resource_type,
    resourceId: event.resource_id,
    status: event.status,
    severity: event.severity,
    critical: event.is_critical,
    channel: event.channel,
    integration: event.integration,
    durationMs: event.duration_ms,
    attempt: event.attempt,
    resultCode: event.result_code,
    idempotencyKey: event.idempotency_key ?? null,
    relatedIds: event.related_ids,
    metadata: event.metadata,
    deploymentSha: event.deployment_sha,
  };

  return <Modal
    open
    onClose={onClose}
    title={explanation.title}
    className="max-w-3xl"
    titleContent={<div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-content sm:text-xl">{explanation.title}</h2><span className={cn("rounded-full border px-2 py-1 text-xs", statusClass[event.status] ?? statusClass.pending)}>{explanation.statusLabel}</span>{event.is_critical ? <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300">Crítico</span> : null}</div><p className="mt-2 text-sm leading-6 text-content-muted">{explanation.summary}</p></div>}
    footer={<><Button onClick={() => onShowTrace(event.trace_id)}>Ver trajetória completa</Button><Button onClick={onClose}>Fechar</Button></>}
  >
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-4"><h3 className="text-sm font-semibold text-sky-200">O que isso significa?</h3><p className="mt-2 text-sm leading-6 text-content-secondary">{explanation.statusDescription}</p></div>
        <div className={cn("rounded-xl border p-4", event.status === "error" ? "border-rose-500/25 bg-rose-500/10" : event.status === "blocked" ? "border-amber-500/25 bg-amber-500/10" : "border-emerald-500/25 bg-emerald-500/10")}><h3 className="text-sm font-semibold text-content">Impacto real</h3><p className="mt-2 text-sm leading-6 text-content-secondary">{explanation.impact}</p></div>
      </section>

      <section className="rounded-xl border border-line bg-surface-elevated/20 p-4"><h3 className="text-sm font-semibold text-content">Você precisa fazer alguma coisa?</h3><p className="mt-2 text-sm leading-6 text-content-secondary">{explanation.recommendedAction}</p></section>

      <section><h3 className="mb-3 text-sm font-semibold text-content">Informações deste registro</h3><dl className="grid gap-2 sm:grid-cols-2">
        <DetailItem label="Quando aconteceu" value={new Date(event.occurred_at).toLocaleString()} />
        <DetailItem label="Responsável" value={`${explanation.actorLabel}${event.actor_id ? ` · ${event.actor_id}` : ""}`} />
        <DetailItem label="Área do sistema" value={explanation.moduleLabel} />
        <DetailItem label="O que essa área faz" value={explanation.moduleDescription} />
        <DetailItem label="Resultado" value={explanation.resultLabel} />
        <DetailItem label="Gravidade" value={explanation.severityLabel} />
        <DetailItem label="Recurso afetado" value={event.resource_type ? `${event.resource_type}${event.resource_id ? ` · ${event.resource_id}` : ""}` : "Não informado"} />
        <DetailItem label="Canal ou integração" value={[event.channel, event.integration].filter(Boolean).join(" · ") || "Não se aplica"} />
        <DetailItem label="Tempo gasto" value={event.duration_ms == null ? "Não informado" : `${event.duration_ms} milissegundos`} />
        <DetailItem label="Tentativa" value={String(event.attempt || 1)} />
      </dl></section>

      <details className="rounded-xl border border-line bg-black/10 p-4"><summary className="cursor-pointer text-sm font-semibold text-content">Detalhes técnicos completos</summary><p className="mt-2 text-xs leading-5 text-content-muted">Use esta parte somente para investigação técnica. Os dados sensíveis já chegam sanitizados pelo backend.</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/20 p-3 text-xs text-content-secondary">{JSON.stringify(technicalDetails, null, 2)}</pre></details>
    </div>
  </Modal>;
}

export function OperationalAuditPage() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [nextCursor, setNextCursor] = useState<{ occurredAt: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
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
          <Select aria-label="Tipo do responsável" value={filters.actor_type} onChange={(event) => setFilters({ ...filters, actor_type: event.target.value })}><option value="">Todos os responsáveis</option>{["customer", "administrator", "agent", "system", "webhook", "cron", "worker", "external_integration"].map((value) => <option key={value} value={value}>{auditActorLabel(value)}</option>)}</Select>
          <Select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos os status</option>{["pending", "running", "completed", "blocked", "cancelled", "error"].map((value) => <option key={value} value={value}>{auditStatusLabel(value)}</option>)}</Select>
          <Select aria-label="Severidade" value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">Todas as severidades</option>{["debug", "info", "warning", "error", "critical"].map((value) => <option key={value} value={value}>{auditSeverityLabel(value)}</option>)}</Select>
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
        <div className="border-b border-line/60 bg-sky-500/5 px-4 py-3 text-sm text-content-secondary">
          Clique em qualquer registro para entender, em linguagem simples, o que aconteceu e se você precisa fazer algo.
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="border-b border-line bg-surface-elevated/40 text-xs uppercase text-content-muted"><tr>{["Horário", "Status", "O que aconteceu", "Responsável", "Área", "Duração", "Resultado", "Trajetória"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>
          {events.map((event) => {
            const explanation = explainOperationalAuditEvent(event);
            return <tr
              key={event.id}
              onClick={() => setSelectedEvent(event)}
              className="cursor-pointer border-b border-line/60 align-top transition-colors hover:bg-surface-elevated/40"
            >
              <td className="whitespace-nowrap px-4 py-3 text-content-secondary">{new Date(event.occurred_at).toLocaleString()}</td>
              <td className="px-4 py-3"><span className={cn("whitespace-nowrap rounded-full border px-2 py-1 text-xs", statusClass[event.status] ?? statusClass.pending)}>{explanation.statusLabel}</span>{event.is_critical ? <span className="ml-1 text-rose-400" title="Evento crítico">●</span> : null}</td>
              <td className="max-w-[360px] px-4 py-3"><button onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelectedEvent(event); }} className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"><span className="font-medium text-content">{explanation.title}</span><span className="mt-1 line-clamp-2 text-xs leading-5 text-content-muted">{explanation.summary}</span><span className="mt-1 inline-block text-xs font-medium text-primary">Ver explicação completa</span></button></td>
              <td className="px-4 py-3 text-content-secondary"><div>{explanation.actorLabel}</div><div className="max-w-40 truncate text-xs text-content-faint">{event.actor_id ?? "Sem identificador"}</div></td>
              <td className="px-4 py-3"><div className="font-medium text-content-secondary">{explanation.moduleLabel}</div><div className="mt-1 max-w-48 truncate font-mono text-[11px] text-content-faint">{event.module} · {event.action}</div></td>
              <td className="px-4 py-3 text-content-secondary">{event.duration_ms == null ? "Não informado" : `${event.duration_ms} ms`}</td>
              <td className="max-w-56 px-4 py-3 text-content-secondary"><div>{explanation.resultLabel}</div><div className="mt-1 truncate font-mono text-[11px] text-content-faint">{event.result_code ?? "sem código"}</div></td>
              <td className="px-4 py-3"><button onClick={(clickEvent) => { clickEvent.stopPropagation(); void showTrace(event.trace_id); }} className="max-w-32 truncate text-primary hover:underline">Ver trajetória</button></td>
            </tr>;
          })}
        </tbody></table></div>
        {!events.length && !loading ? <p className="p-8 text-center text-sm text-content-faint">Nenhum evento encontrado.</p> : null}
        {loading ? <p className="p-4 text-center text-sm text-content-muted">Carregando…</p> : null}
        {nextCursor && !loading ? <div className="p-4 text-center"><Button onClick={() => void load(true, nextCursor)}>Carregar mais</Button></div> : null}
      </section>

      {expanded && expanded.startsWith("trace:") ? <section className="rounded-xl border border-line bg-surface-card p-5"><div className="flex justify-between gap-3"><div><h2 className="font-semibold text-content">Trajetória completa da operação</h2><p className="mt-1 text-sm text-content-muted">Todos os passos relacionados pelo mesmo identificador.</p></div><button onClick={() => setExpanded(null)} className="text-content-muted">Fechar</button></div><div className="mt-4 space-y-3">{traceEvents?.map((event) => { const explanation = explainOperationalAuditEvent(event); return <button key={event.id} onClick={() => setSelectedEvent(event)} className="block w-full border-l-2 border-primary/40 py-1 pl-4 text-left hover:border-primary"><p className="text-sm font-medium text-content">{explanation.title}</p><p className="mt-1 text-xs text-content-muted">{new Date(event.occurred_at).toLocaleString()} · {explanation.statusLabel} · {explanation.resultLabel}</p></button>; }) ?? <p className="text-sm text-content-muted">Carregando trajetória…</p>}</div></section> : null}

      <AuditEventDetailsModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onShowTrace={(traceId) => {
          setSelectedEvent(null);
          void showTrace(traceId);
        }}
      />
    </div>
  );
}
