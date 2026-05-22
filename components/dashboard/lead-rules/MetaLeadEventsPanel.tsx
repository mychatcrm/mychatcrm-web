"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { metaLeadEventsRealtimeChannel } from "@/lib/meta-leads/realtime";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { MetaLeadEventRow } from "@/lib/server/meta-lead-events-db";
import { cn } from "@/lib/utils";

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
    skipped_duplicate: "Duplicado",
    conversation_state_created: "Conversa",
    ai_response_generated: "IA gerada",
    whatsapp_sent: "WhatsApp enviado",
    whatsapp_failed: "WhatsApp falhou",
  };
  return map[step] ?? step;
}

function crmBadge(status: string) {
  if (status === "synced") return { label: "CRM OK", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (status === "failed") return { label: "CRM erro", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" };
  return { label: "CRM pendente", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" };
}

function waBadge(status: string) {
  if (status === "sent") return { label: "WhatsApp OK", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  if (status === "failed") return { label: "WhatsApp erro", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" };
  if (status === "skipped") return { label: "WhatsApp —", className: "border-line bg-surface-elevated/80 text-content-muted" };
  return { label: "WhatsApp pendente", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" };
}

export function MetaLeadEventsPanel({ tenantId }: { tenantId: string }) {
  const { isLight } = usePanelAppearance();
  const [events, setEvents] = useState<MetaLeadEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableReady, setTableReady] = useState(true);

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
        <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          Atualizar
        </Button>
      </div>

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

      <ul className="space-y-3">
        {events.map((ev) => {
          const crm = crmBadge(ev.crm_sync_status);
          const wa = waBadge(ev.whatsapp_status);
          const lastSteps = Array.isArray(ev.steps_log) ? ev.steps_log.slice(-4) : [];
          return (
            <li
              key={ev.id}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                isLight ? "border-slate-200/70 bg-white/60" : "border-line/70 bg-surface-deep/40",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-content">{ev.name || "Lead sem nome"}</p>
                  <p className="mt-0.5 text-xs text-content-muted">
                    {ev.phone || "—"} {ev.email ? `· ${ev.email}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge className={cn("text-[10px]", crm.className)}>{crm.label}</Badge>
                  <Badge className={cn("text-[10px]", wa.className)}>{wa.label}</Badge>
                </div>
              </div>

              <dl className="mt-3 grid gap-1 text-xs text-content-secondary sm:grid-cols-2">
                <div>
                  <dt className="text-content-muted">Formulário</dt>
                  <dd className="truncate font-medium text-content">{ev.form_name || ev.form_id || "—"}</dd>
                </div>
                <div>
                  <dt className="text-content-muted">Página</dt>
                  <dd className="truncate font-medium text-content">{ev.page_name || ev.page_id}</dd>
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
                      <span className="text-content-muted"> ({ev.agent_resolution_source})</span>
                    ) : null}
                  </dd>
                </div>
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
                <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {ev.error_message}
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
    </section>
  );
}
