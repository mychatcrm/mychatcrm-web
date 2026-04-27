"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Calendar, ChevronRight, Radio, RefreshCw, Send, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import type { DashboardDataset } from "@/lib/dashboard-data";
import { LEAD_EXTRAS_STORAGE_KEY, LEAD_EXTRAS_UPDATED_EVENT, loadLeadExtras } from "@/lib/crm-lead-extras";
import { CRM_LEADS_UPDATED_EVENT, crmLeadsStorageKey, loadCrmLeadsSnapshot } from "@/lib/crm-leads-storage";
import { CRM_FUNNELS_STORAGE_KEY } from "@/lib/crm-funnels";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import { AGENDA_EVENTS_LS_KEY, AGENDA_EVENTS_UPDATED_EVENT, loadAgendaEvents } from "@/components/dashboard/agenda/agenda-storage";
import {
  DISPAROS_DRAFTS_STORAGE_KEY,
  DISPAROS_DRAFTS_UPDATED_EVENT,
  loadDisparosDrafts,
} from "@/components/dashboard/disparos/disparos-drafts-storage";
import { buildLembretesFeed, type LembretesPulseItem } from "./build-lembretes-feed";

function formatWhen(at: Date | null) {
  if (!at) return "Sem data definida";
  return at.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceIcon(source: LembretesPulseItem["source"]) {
  switch (source) {
    case "agenda":
    case "resumo-agenda":
      return Calendar;
    case "crm-lead":
    case "crm-tarefa":
    case "crm-atividade":
      return Users;
    case "disparo":
    case "campanha":
      return Send;
    case "alerta":
    case "regra":
      return Bell;
    default:
      return Zap;
  }
}

type FeedFilter = "todos" | "agenda" | "crm" | "disparos" | "automacoes";

function matchesFilter(item: LembretesPulseItem, f: FeedFilter) {
  if (f === "todos") return true;
  if (f === "agenda") return item.source === "agenda" || item.source === "resumo-agenda";
  if (f === "crm") return item.source === "crm-lead" || item.source === "crm-tarefa" || item.source === "crm-atividade";
  if (f === "disparos") return item.source === "disparo" || item.source === "campanha";
  return item.source === "regra" || item.source === "alerta";
}

export function LembretesHub({ dataset }: { dataset: DashboardDataset }) {
  const { isLight } = usePanelAppearance();
  const { funnels } = useCrmFunnels();
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<FeedFilter>("todos");
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const bump = useCallback(() => {
    setTick((t) => t + 1);
    setLastSync(new Date());
  }, []);

  useEffect(() => {
    bump();
    const onExtras = () => bump();
    const onAgenda = () => bump();
    const onDisparos = () => bump();
    const onCrmLeads = () => bump();
    window.addEventListener(LEAD_EXTRAS_UPDATED_EVENT, onExtras);
    window.addEventListener(AGENDA_EVENTS_UPDATED_EVENT, onAgenda);
    window.addEventListener(DISPAROS_DRAFTS_UPDATED_EVENT, onDisparos);
    window.addEventListener(CRM_LEADS_UPDATED_EVENT, onCrmLeads);
    const leadsKey = crmLeadsStorageKey(dataset.tenantId);
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === AGENDA_EVENTS_LS_KEY ||
        e.key === DISPAROS_DRAFTS_STORAGE_KEY ||
        e.key === LEAD_EXTRAS_STORAGE_KEY ||
        e.key === CRM_FUNNELS_STORAGE_KEY ||
        e.key === leadsKey
      ) {
        bump();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", bump);
    const id = window.setInterval(bump, 60_000);
    return () => {
      window.removeEventListener(LEAD_EXTRAS_UPDATED_EVENT, onExtras);
      window.removeEventListener(AGENDA_EVENTS_UPDATED_EVENT, onAgenda);
      window.removeEventListener(DISPAROS_DRAFTS_UPDATED_EVENT, onDisparos);
      window.removeEventListener(CRM_LEADS_UPDATED_EVENT, onCrmLeads);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", bump);
      window.clearInterval(id);
    };
  }, [bump, dataset.tenantId]);

  const feed = useMemo(() => {
    void tick;
    const leads = loadCrmLeadsSnapshot(dataset.tenantId, dataset.leads);
    return buildLembretesFeed({
      dataset,
      leads,
      funnels,
      extras: loadLeadExtras(),
      agendaEvents: loadAgendaEvents(),
      disparosDrafts: loadDisparosDrafts(),
    });
  }, [dataset, funnels, tick]);

  const filtered = useMemo(() => feed.filter((row) => matchesFilter(row, filter)), [feed, filter]);

  const upcomingCount = useMemo(() => {
    const st = new Date();
    st.setHours(0, 0, 0, 0);
    return feed.filter((i) => i.at && i.at >= st).length;
  }, [feed]);

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:rounded-xl sm:p-5",
          isLight ? "border-emerald-200/80 bg-emerald-50/60" : "border-emerald-500/25 bg-emerald-500/10",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-500/20", isLight ? "text-emerald-600" : "text-emerald-300")}>
            <Radio className="size-5 animate-pulse" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-content">Sincronizado com o seu MyChatCRM</p>
            <p className="mt-1 text-sm text-content-secondary">
              Esta central junta <strong className="text-content">agenda</strong>, <strong className="text-content">CRM</strong>{" "}
              (proximas acoes, tarefas e movimentos do funil), <strong className="text-content">disparos</strong>,{" "}
              <strong className="text-content">alertas</strong> e <strong className="text-content">automacoes</strong>. Atualiza ao
              guardar em qualquer modulo, entre separadores e entre abas (via armazenamento local).
            </p>
            {lastSync ? (
              <p className="mt-2 text-xs text-content-secondary">
                Ultima leitura: {lastSync.toLocaleString("pt-BR")} · {upcomingCount} itens com data a partir de hoje
              </p>
            ) : null}
          </div>
        </div>
        <Button type="button" variant="secondary" className="shrink-0 gap-2 self-start sm:self-center" onClick={() => bump()}>
          <RefreshCw className="size-4" aria-hidden />
          Atualizar agora
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["todos", "Todos"],
            ["agenda", "Agenda"],
            ["crm", "CRM"],
            ["disparos", "Disparos"],
            ["automacoes", "Automacoes / sistema"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              filter === id
                ? "border-primary bg-primary text-white"
                : "border-line bg-surface-card/50 text-content-secondary hover:border-primary/40 hover:text-content",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface-deep/25 sm:rounded-xl">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h3 className="text-sm font-semibold text-content">Linha do tempo unificada</h3>
          <p className="mt-0.5 text-xs text-content-secondary">
            {filtered.length} lembrete(s) neste filtro · ordenacao: proximos primeiro, depois passados, depois sem data
          </p>
        </div>
        <ul className="max-h-[min(70vh,720px)] divide-y divide-line overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-content-secondary sm:px-5">Nada neste filtro.</li>
          ) : (
            filtered.map((row) => {
              const Icon = sourceIcon(row.source);
              const body = (
                <div className="flex gap-3 px-4 py-3 sm:px-5">
                  <div className="mt-0.5 shrink-0 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="text-[10px]">{row.label}</Badge>
                      <span className="text-xs text-content-secondary">{formatWhen(row.at)}</span>
                    </div>
                    <p className="mt-1 font-medium text-content">{row.title}</p>
                    {row.detail ? <p className="mt-0.5 text-sm text-content-secondary">{row.detail}</p> : null}
                  </div>
                  {row.href ? (
                    <Link
                      href={row.href}
                      className="flex shrink-0 items-center gap-1 self-center text-xs font-semibold text-primary hover:underline"
                    >
                      Abrir
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              );
              return <li key={row.id}>{body}</li>;
            })
          )}
        </ul>
      </div>

      <p className="text-center text-[11px] text-content-secondary">
        Em producao com backend, o mesmo agregador alimenta notificacoes push, WhatsApp e e-mail — uma unica fila para nada escapar.
      </p>
    </div>
  );
}
