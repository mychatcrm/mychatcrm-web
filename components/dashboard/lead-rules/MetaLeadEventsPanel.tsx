"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, Trash2, UserCog } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { metaLeadEventsRealtimeChannel } from "@/lib/meta-leads/realtime";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";
import { bucketMetaLeadEventStep, type MetaLeadEventBucket } from "@/lib/meta-lead-event-status";
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import type { TeamEmployee, TeamHierarchyRole } from "@/lib/team-employees-types";
import { cn } from "@/lib/utils";

type FilterId = "all" | MetaLeadEventBucket;

const FILTER_OPTIONS: { id: FilterId; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "novo", label: "Novo" },
  { id: "ok", label: "OK" },
  { id: "erro", label: "Erro" },
];

const ROLE_LABEL: Record<TeamHierarchyRole, string> = {
  director: "Diretor",
  manager: "Gerente",
  seller: "Vendedor",
};

type AgentOption = { id: string; nome: string };
type AssignTarget = { type: "agent" | "employee"; id: string };

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function stepLabel(step: string): string {
  const map: Record<string, string> = {
    lead_received: "Recebido",
    meta_tenant_resolved_by_form_rule: "Tenant pela regra",
    graph_data_fetched: "Dados Meta",
    graph_fetch_failed: "Falha Graph API",
    crm_lead_created: "CRM criado",
    crm_lead_updated: "CRM atualizado",
    crm_lead_failed: "Falha CRM",
    form_fields_saved: "Campos salvos",
    agent_resolved: "Agente definido",
    skipped_no_phone: "Sem telefone",
    skipped_no_agent: "Sem agente",
    skipped_no_evolution: "Sem WhatsApp",
    skipped_duplicate: "Mesmo leadgen",
    skipped_initial_outreach: "WA não enviado",
    skipped_human_attending: "Humano ativo",
    conversation_state_created: "Conversa",
    ai_response_generated: "IA gerada",
    whatsapp_sent: "WhatsApp enviado",
    whatsapp_failed: "WhatsApp falhou",
    blocked_unauthorized_form: "Formulário não autorizado",
    blocked_form_not_registered_in_lead_rules: "Formulário não cadastrado nas regras",
    blocked_ambiguous_meta_page_form_tenant: "Página/form ambíguos",
    blocked_missing_meta_connection_for_resolved_tenant: "Conexão Meta ausente",
    blocked_historical_lead: "Lead anterior à regra",
  };
  return map[step] ?? step;
}

function resolutionSourceLabel(source: string | null): string {
  const map: Record<string, string> = {
    rule: "regra ativa",
    mapping_current: "mapeamento sincronizado",
    unauthorized_form: "não autorizado",
    no_matching_rule: "sem regra",
    invalid_agent: "agente inválido",
    none: "sem agente",
    routing: "roteamento (legado)",
    instance_default: "padrão instância (legado)",
    tenant_active: "agente ativo tenant (legado)",
  };
  return source ? (map[source] ?? source) : "";
}

function crmBadge(status: string, errorMessage: string | null) {
  if (status === "synced") return { label: "CRM OK", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (status === "failed") return { label: "CRM erro", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" };
  if (status === "blocked") {
    if (errorMessage === "form_not_registered_in_lead_rules") {
      return {
        label: "CRM: form não cadastrado nas regras",
        className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
      };
    }
    return {
      label: "CRM bloqueado",
      className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
    };
  }
  return { label: "CRM pendente", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" };
}

function waBadge(status: string, errorMessage: string | null) {
  if (status === "sent") return { label: "WhatsApp OK", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (status === "failed") return { label: "WhatsApp erro", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" };
  if (status === "blocked") {
    if (errorMessage === "form_not_registered_in_lead_rules") {
      return {
        label: "Bloqueado: form não cadastrado nas regras",
        className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
      };
    }
    if (errorMessage === "form_not_authorized_for_agent") {
      return {
        label: "Bloqueado: form não autorizado para agente",
        className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
      };
    }
    if (errorMessage === "orphan_mapping_without_active_rule") {
      return {
        label: "Bloqueado: mapeamento desatualizado",
        className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
      };
    }
    return {
      label: "Bloqueado: formulário não vinculado",
      className: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
    };
  }
  if (status === "skipped") {
    if (errorMessage === "same_leadgen_already_sent") {
      return { label: "WA: mesmo leadgen", className: "border-line bg-surface-elevated/80 text-content-muted" };
    }
    if (errorMessage === "initial_outreach_already_sent") {
      return { label: "WA: bloqueio antigo", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" };
    }
    if (errorMessage === "human_attending_today") {
      return { label: "WA: humano ativo", className: "border-line bg-surface-elevated/80 text-content-muted" };
    }
    return { label: "WA: não enviado", className: "border-line bg-surface-elevated/80 text-content-muted" };
  }
  return { label: "WhatsApp pendente", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" };
}

function errorMessageHint(message: string | null): string | null {
  if (!message) return null;
  const map: Record<string, string> = {
    same_leadgen_already_sent: "Este leadgen_id já recebeu mensagem inicial.",
    initial_outreach_already_sent: "Regra antiga bloqueou por telefone — corrigido no deploy mais recente.",
    human_attending_today: "Atendimento humano ativo hoje nesta conversa.",
    initial_message_already_exists: "Mensagem meta:{leadgen_id}:initial já existe.",
    no_active_rule_for_form: "Formulário não vinculado a nenhum agente.",
    form_not_registered_in_lead_rules:
      "Formulário não cadastrado em Integrações → Leads. Lead não foi enviado ao CRM.",
    orphan_mapping_without_active_rule: "Mapeamento desatualizado — formulário não vinculado a regra ativa.",
    form_not_authorized_for_agent: "Formulário no CRM, mas agente não autorizado para WhatsApp automático.",
    missing_form_id: "Lead sem form_id — não entra no CRM nem no atendimento automático.",
    historical_meta_lead_before_rule_activation: "Lead anterior à ativação da regra — não entra no CRM.",
    ambiguous_meta_page_form_tenant:
      "Mais de um tenant autoriza a mesma página e formulário. O sistema bloqueou para não enviar pelo agente errado.",
    missing_meta_connection_for_resolved_tenant:
      "A regra autoriza o formulário, mas a conexão Meta deste tenant não foi encontrada para esta página.",
    rules_query_failed:
      "Não foi possível consultar as regras ativas. O sistema bloqueou por segurança antes de acionar o agente.",
  };
  return map[message] ?? message;
}

export function MetaLeadEventsPanel({ tenantId }: { tenantId: string }) {
  const { isLight } = usePanelAppearance();
  const [events, setEvents] = useState<MetaLeadEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableReady, setTableReady] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");

  const counts = useMemo(() => {
    const result: Record<FilterId, number> = { all: events.length, novo: 0, ok: 0, erro: 0 };
    for (const ev of events) result[bucketMetaLeadEventStep(ev.current_step)] += 1;
    return result;
  }, [events]);

  const filteredEvents = useMemo(
    () => (filter === "all" ? events : events.filter((ev) => bucketMetaLeadEventStep(ev.current_step) === filter)),
    [events, filter],
  );

  // ── Direcionamento manual (só disponível pra leads no balde "erro") ──────
  const [assignEventId, setAssignEventId] = useState<string | null>(null);
  const [assignAgents, setAssignAgents] = useState<AgentOption[]>([]);
  const [assignEmployees, setAssignEmployees] = useState<TeamEmployee[]>([]);
  const [assignLoadingOptions, setAssignLoadingOptions] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const assignEvent = useMemo(() => events.find((e) => e.id === assignEventId) ?? null, [events, assignEventId]);

  const openAssignModal = useCallback(
    async (eventId: string) => {
      setAssignEventId(eventId);
      setAssignTarget(null);
      setAssignError(null);
      setAssignLoadingOptions(true);
      try {
        const [agentsRes, employees] = await Promise.all([
          fetch("/api/client/lead-rules/agents", { credentials: "same-origin" }),
          refreshTeamEmployeesFromApi(tenantId),
        ]);
        const agentsJson = (await agentsRes.json().catch(() => ({}))) as { agents?: AgentOption[] };
        setAssignAgents(agentsJson.agents ?? []);
        setAssignEmployees(employees.filter((e) => e.ativo && !e.accountSuspended));
      } catch {
        setAssignError("Erro ao carregar agentes e atendentes.");
      } finally {
        setAssignLoadingOptions(false);
      }
    },
    [tenantId],
  );

  const closeAssignModal = useCallback(() => {
    setAssignEventId(null);
    setAssignTarget(null);
    setAssignError(null);
  }, []);

  const submitAssign = useCallback(async () => {
    if (!assignEventId || !assignTarget) return;
    setAssignSubmitting(true);
    setAssignError(null);
    try {
      const body =
        assignTarget.type === "agent"
          ? { target: "agent", agentId: assignTarget.id }
          : { target: "employee", employeeId: assignTarget.id };
      const res = await fetch(`/api/client/meta/lead-events/${encodeURIComponent(assignEventId)}/assign`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { event?: MetaLeadEventRow; error?: string };
      if (!res.ok || !json.event) throw new Error(json.error ?? "Falha ao direcionar lead");
      const updated = json.event;
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      closeAssignModal();
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Erro ao direcionar lead");
    } finally {
      setAssignSubmitting(false);
    }
  }, [assignEventId, assignTarget, closeAssignModal]);

  const removeFromInbox = useCallback(
    async (eventId: string, leadName: string) => {
      const ok = window.confirm(
        `Remover "${leadName}" da lista de leads recebidos?\n\nO lead no CRM não será excluído.`,
      );
      if (!ok) return;
      setDeletingId(eventId);
      setRemoveError(null);
      try {
        const res = await fetch(`/api/client/meta/lead-events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Falha ao remover");
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
      } catch (e) {
        setRemoveError(e instanceof Error ? e.message : "Erro ao remover");
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/client/meta/lead-events?limit=80", { cache: "no-store" });
      const json = (await res.json()) as { events?: MetaLeadEventRow[]; error?: string; tableReady?: boolean };
      if (!res.ok) throw new Error(json.error ?? "Falha ao carregar leads");
      setEvents(json.events ?? []);
      setTableReady(json.tableReady !== false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    if (!sb || !tenantId) return;

    const channel = sb
      .channel(metaLeadEventsRealtimeChannel(tenantId))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meta_lead_events", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void refresh();
        },
      )
      .subscribe();

    const poll = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [tenantId, refresh]);

  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border p-5 sm:p-6",
        isLight ? "border-slate-200/80 bg-surface-deep" : "border-line/80 bg-surface-card/80 ring-1 ring-white/[0.03]",
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[17px] font-bold tracking-tight text-content sm:text-lg">Leads recebidos</h2>
          <p className="mt-1 text-[13px] text-content-muted">
            Formulários Meta Lead Ads em tempo real — CRM, agente e WhatsApp automático.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          Atualizar
        </Button>
      </div>

      <div
        className={cn(
          "mb-4 inline-flex flex-wrap gap-1 rounded-lg border p-1",
          isLight ? "border-slate-200 bg-surface-deep" : "border-line/80 bg-surface-card/60",
        )}
        role="tablist"
        aria-label="Filtrar leads recebidos"
      >
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={filter === opt.id}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              filter === opt.id ? "bg-primary text-primary-foreground" : "text-content-muted hover:text-content",
            )}
            onClick={() => setFilter(opt.id)}
          >
            {opt.label} ({counts[opt.id]})
          </button>
        ))}
      </div>

      {removeError ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {removeError}
        </p>
      ) : null}

      {!tableReady ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          A tabela de eventos ainda não foi aplicada no Supabase. Execute a migration{" "}
          <code className="text-xs">20260522120000_meta_lead_events.sql</code>.
        </p>
      ) : null}

      {error ? (
        <p className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-content-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Carregando…
        </div>
      ) : null}

      {!loading && events.length === 0 && !error ? (
        <p className="py-10 text-center text-sm text-content-muted">
          Nenhum lead Meta recebido ainda. Conecte a página em Integrações e envie um teste pelo formulário.
        </p>
      ) : null}

      {!loading && events.length > 0 && filteredEvents.length === 0 ? (
        <p className="py-10 text-center text-sm text-content-muted">Nenhum lead nesse filtro.</p>
      ) : null}

      <ul className="space-y-3">
        {filteredEvents.map((ev) => {
          const crm = crmBadge(ev.crm_sync_status, ev.error_message);
          const wa = waBadge(ev.whatsapp_status, ev.error_message);
          const hint = errorMessageHint(ev.error_message);
          const lastSteps = Array.isArray(ev.steps_log) ? ev.steps_log.slice(-4) : [];
          const eventBucket = bucketMetaLeadEventStep(ev.current_step);
          // Direcionamento manual fica disponível em Erro (nunca foi atendido) e em
          // OK (o sistema marcou como atendido, mas o cliente quer trocar o
          // atendente/agente porque pode não ter sido de verdade) — não aparece em
          // "novo" pra não interferir com o pipeline automático ainda em curso.
          const canManuallyAssign = eventBucket === "erro" || eventBucket === "ok";
          return (
            <li
              key={ev.id}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                isLight ? "border-slate-200/70 bg-white/60" : "border-line/70 bg-surface-deep/40",
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-content">{ev.name || "Lead sem nome"}</p>
                  <p className="mt-0.5 break-all text-xs text-content-muted sm:break-normal">
                    {ev.phone || "—"} {ev.email ? `· ${ev.email}` : ""}
                  </p>
                </div>
                <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
                  <Badge className={cn("text-[10px]", crm.className)} title={ev.lead_id ? `Lead CRM: ${ev.lead_id}` : undefined}>
                    {crm.label}
                  </Badge>
                  <Badge className={cn("text-[10px]", wa.className)}>{wa.label}</Badge>
                  {canManuallyAssign ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 w-full px-2 text-[11px] sm:w-auto"
                      onClick={() => void openAssignModal(ev.id)}
                      title="Direcionar manualmente para um agente de IA ou atendente humano"
                    >
                      <UserCog className="h-3.5 w-3.5" aria-hidden />
                      Direcionar manualmente
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 w-full px-2 text-[11px] sm:w-auto"
                    disabled={deletingId === ev.id}
                    onClick={() => void removeFromInbox(ev.id, ev.name || ev.phone || "lead")}
                    title="Remover só desta lista (mantém no CRM)"
                  >
                    {deletingId === ev.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Remover
                  </Button>
                </div>
              </div>

              <dl className="mt-3 grid gap-1 text-xs text-content-secondary sm:grid-cols-2">
                <div>
                  <dt className="text-content-muted">Formulário</dt>
                  <dd className="truncate font-medium text-content">{ev.form_name || ev.form_id || "—"}</dd>
                  {ev.form_name && ev.form_id ? (
                    <dd className="truncate font-mono text-[10px] text-content-muted">ID {ev.form_id}</dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-content-muted">Página</dt>
                  <dd className="truncate font-medium text-content">{ev.page_name || ev.page_id}</dd>
                  {ev.page_name ? (
                    <dd className="truncate font-mono text-[10px] text-content-muted">ID {ev.page_id}</dd>
                  ) : null}
                </div>
                {ev.campaign_name ? (
                  <div>
                    <dt className="text-content-muted">Campanha</dt>
                    <dd className="truncate">{ev.campaign_name}</dd>
                  </div>
                ) : null}
                {ev.ad_name ? (
                  <div>
                    <dt className="text-content-muted">Anúncio</dt>
                    <dd className="truncate">{ev.ad_name}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-content-muted">Recebido</dt>
                  <dd>{formatWhen(ev.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-content-muted">Agente</dt>
                  <dd className="truncate">
                    {ev.agent_id || "—"}
                    {ev.agent_resolution_source ? (
                      <span className="text-content-muted">
                        {" "}
                        ({resolutionSourceLabel(ev.agent_resolution_source)})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-content-muted">Leadgen ID</dt>
                  <dd className="truncate font-mono text-[10px]">{ev.leadgen_id}</dd>
                </div>
                {ev.lead_id ? (
                  <div className="sm:col-span-2">
                    <dt className="text-content-muted">CRM</dt>
                    <dd>
                      <Link
                        href={`/dashboard/crm?lead=${ev.lead_id}`}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Abrir lead no CRM ({ev.phone || "sem telefone"})
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-content-muted">Etapa:</span>
                <Badge className="border-primary/30 bg-primary/10 text-[10px] text-primary">
                  {stepLabel(ev.current_step)}
                </Badge>
                {lastSteps.map((s, i) => {
                  const step = typeof s === "object" && s && "step" in s ? String((s as { step: string }).step) : "";
                  if (!step) return null;
                  return (
                    <span key={`${ev.id}-step-${i}`} className="text-[10px] text-content-muted">
                      {i > 0 ? "→ " : ""}
                      {stepLabel(step)}
                    </span>
                  );
                })}
              </div>

              {ev.error_message ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium">{ev.error_message}</span>
                    {hint ? <span className="block text-content-muted">{hint}</span> : null}
                  </span>
                </p>
              ) : ev.current_step === "whatsapp_sent" ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Contato automático enviado
                </p>
              ) : ev.whatsapp_status === "pending" && ev.crm_sync_status === "synced" ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-content-muted">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Processando contato automático…
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {assignEventId ? (
        <Modal
          open={true}
          onClose={closeAssignModal}
          title="Direcionar manualmente"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeAssignModal} disabled={assignSubmitting}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void submitAssign()}
                isLoading={assignSubmitting}
                disabled={!assignTarget}
              >
                Confirmar
              </Button>
            </div>
          }
        >
          <p className="mb-4 text-sm text-content-secondary">
            Escolha um agente de IA ou um atendente humano pra assumir{" "}
            <strong className="text-content">{assignEvent?.name || assignEvent?.phone || "este lead"}</strong>.
          </p>

          {assignLoadingOptions ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-content-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Carregando agentes e atendentes…
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
                  Agente de IA
                </p>
                {assignAgents.length === 0 ? (
                  <p className="text-xs text-content-muted">Nenhum agente de IA ativo neste tenant.</p>
                ) : (
                  <div className="space-y-1">
                    {assignAgents.map((agent) => (
                      <label
                        key={agent.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                          assignTarget?.type === "agent" && assignTarget.id === agent.id
                            ? "border-primary bg-primary/5"
                            : "border-line/60 hover:border-line",
                        )}
                      >
                        <input
                          type="radio"
                          name="assign-target"
                          checked={assignTarget?.type === "agent" && assignTarget.id === agent.id}
                          onChange={() => setAssignTarget({ type: "agent", id: agent.id })}
                        />
                        <span className="text-content">{agent.nome}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
                  Atendente humano
                </p>
                {assignEmployees.length === 0 ? (
                  <p className="text-xs text-content-muted">Nenhum funcionário ativo cadastrado neste tenant.</p>
                ) : (
                  <div className="space-y-1">
                    {assignEmployees.map((employee) => (
                      <label
                        key={employee.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                          assignTarget?.type === "employee" && assignTarget.id === employee.id
                            ? "border-primary bg-primary/5"
                            : "border-line/60 hover:border-line",
                        )}
                      >
                        <input
                          type="radio"
                          name="assign-target"
                          checked={assignTarget?.type === "employee" && assignTarget.id === employee.id}
                          onChange={() => setAssignTarget({ type: "employee", id: employee.id })}
                        />
                        <span className="text-content">
                          {employee.nome} <span className="text-content-muted">({ROLE_LABEL[employee.hierarchyRole]})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {assignError ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              {assignError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </section>
  );
}
