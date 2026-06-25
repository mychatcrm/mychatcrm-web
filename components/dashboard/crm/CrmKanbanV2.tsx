"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Clock, Plus, Search, User } from "lucide-react";
import type { ClientSession } from "@/lib/client-auth";
import type { DashboardDataset, ClientLead } from "@/lib/dashboard-data";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import { fetchCrmLeadsFromApi, loadCrmLeadsFromApiWithLocalMigration } from "@/lib/crm-leads-storage";
import { normalizeLeadsForVisibleCrmFunnel, preferredDefaultCrmFunnelId } from "@/lib/crm-visible-leads";
import { formatBRL } from "@/lib/utils";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

const AVATAR_PALETTES = [
  { bg: "#fde4d3", fg: "#B22A00" },
  { bg: "#dbeafe", fg: "#1d4ed8" },
  { bg: "#dcfce7", fg: "#067a3c" },
  { bg: "#fae8ff", fg: "#a21caf" },
  { bg: "#fef3c7", fg: "#a16207" },
  { bg: "#e0e7ff", fg: "#4338ca" },
] as const;

function avatarPalette(name: string) {
  const code = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_PALETTES[code % AVATAR_PALETTES.length]!;
}

const COLUMN_DOTS = ["#3b82f6", "#F24400", "#f59e0b", "#00A650"] as const;

function colDot(index: number): string {
  return COLUMN_DOTS[index % COLUMN_DOTS.length]!;
}

// ---------------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------------

function LeadCard({ lead }: { lead: ClientLead }) {
  const pal = avatarPalette(lead.nome);
  const allTags = [lead.tag, ...lead.tags].filter(Boolean).slice(0, 3);
  const isIA = !lead.responsavel || lead.agenteAtendendo;

  return (
    <div className="cursor-grab rounded-[12px] border border-mc-border bg-mc-surface p-3.5 active:cursor-grabbing">
      {/* Avatar + name */}
      <div className="mb-3 flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
          style={{ background: pal.bg, color: pal.fg }}
        >
          {initials(lead.nome)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-mc-text">{lead.nome}</p>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-mc-muted">
            <Building2 size={10} strokeWidth={1.9} className="shrink-0" />
            <span className="truncate">{lead.empresa || lead.origem}</span>
          </div>
        </div>
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {isIA && (
            <span className="rounded-full border border-[#c9efd6] bg-[#ecfdf3] px-2 py-0.5 text-[10.5px] font-semibold text-[#067a3c]">
              ✦ IA
            </span>
          )}
          {allTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-mc-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-mc-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: value + meta */}
      <div className="flex items-center justify-between border-t border-mc-border pt-2.5">
        <span className="text-[15px] font-extrabold tracking-tight text-mc-text">
          {formatBRL(lead.valor)}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-mc-muted">
          <Clock size={10} strokeWidth={1.9} />
          {lead.ultimoContato}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function KanbanColumn({
  title,
  dotColor,
  leads,
  index,
}: {
  title: string;
  dotColor: string;
  leads: ClientLead[];
  index: number;
}) {
  const totalValue = leads.reduce((acc, l) => acc + l.valor, 0);

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col">
      {/* Column header */}
      <div className="mb-1 flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
          <span className="text-[14.5px] font-bold tracking-tight text-mc-text">{title}</span>
          <span className="rounded-full bg-mc-border px-2 py-0.5 text-[11.5px] font-semibold text-mc-muted">
            {leads.length}
          </span>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-mc-base text-mc-muted transition hover:bg-mc-surface-2 hover:text-mc-text"
          aria-label={`Adicionar lead em ${title}`}
        >
          <Plus size={16} strokeWidth={1.9} />
        </button>
      </div>
      <p className="mb-3 px-1 text-[12px] font-semibold text-mc-muted">
        {formatBRL(totalValue)}
      </p>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto pr-0.5">
        <div className="space-y-2.5">
          {leads.length === 0 && (
            <div className="flex min-h-[100px] items-center justify-center rounded-mc-base border border-dashed border-mc-border text-[12px] text-mc-muted">
              Sem leads
            </div>
          )}
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CrmKanbanV2({
  dataset,
  session,
}: {
  dataset: DashboardDataset;
  session: ClientSession;
}) {
  const { funnels } = useCrmFunnels();
  const [leads, setLeads] = useState<ClientLead[]>(dataset.leads);
  const [search, setSearch] = useState("");
  const [viewFilter, setViewFilter] = useState<"all" | "mine">("all");

  // Active funnel
  const [funnelId, setFunnelId] = useState(() => preferredDefaultCrmFunnelId(funnels));

  const activeFunnel = useMemo(
    () => funnels.find((f) => f.id === funnelId) ?? funnels[0],
    [funnels, funnelId],
  );

  // Update funnel id when funnels load
  useEffect(() => {
    if (funnels.length > 0 && (!funnelId || !funnels.some((f) => f.id === funnelId))) {
      setFunnelId(preferredDefaultCrmFunnelId(funnels));
    }
  }, [funnels, funnelId]);

  // Load leads from API
  useEffect(() => {
    const fallback = dataset.leads;
    loadCrmLeadsFromApiWithLocalMigration(dataset.tenantId, fallback)
      .then((remote) => {
        const visible = normalizeLeadsForVisibleCrmFunnel(remote, funnels);
        setLeads(visible);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.tenantId]);

  // Filtered leads for active funnel
  const filteredLeads = useMemo(() => {
    if (!activeFunnel) return [];
    return leads.filter((lead) => {
      const inFunnel = lead.funilId === activeFunnel.id;
      const matchSearch =
        !search ||
        `${lead.nome} ${lead.empresa} ${lead.tag}`.toLowerCase().includes(search.toLowerCase());
      const matchView =
        viewFilter === "all" ||
        (viewFilter === "mine" && lead.responsavel === session.displayName);
      return inFunnel && matchSearch && matchView;
    });
  }, [leads, activeFunnel, search, viewFilter, session.displayName]);

  // Group leads by column
  const columns = useMemo(() => {
    if (!activeFunnel) return [];
    return activeFunnel.columns.map((col, i) => ({
      ...col,
      dotColor: colDot(i),
      leads: filteredLeads.filter((lead) => lead.status === col.id),
    }));
  }, [activeFunnel, filteredLeads]);

  const totalLeads = filteredLeads.length;
  const totalValue = filteredLeads.reduce((acc, l) => acc + l.valor, 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-mc-bg">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-mc-border bg-mc-surface px-7 py-4">
        <div>
          <h2 className="text-[21px] font-extrabold tracking-tight text-mc-text">CRM Kanban</h2>
          <p className="mt-0.5 text-[13px] text-mc-muted">
            {totalLeads} leads ativos · {formatBRL(totalValue)} em negociação
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Funnel selector (if more than one funnel) */}
          {funnels.length > 1 && (
            <select
              value={funnelId}
              onChange={(e) => setFunnelId(e.target.value)}
              className="rounded-mc-base border border-mc-border bg-mc-surface-2 px-3 py-2 text-[13px] text-mc-text focus:border-[#F24400] focus:outline-none"
            >
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          )}

          {/* Search */}
          <div className="hidden items-center gap-2 rounded-mc-base bg-mc-surface-2 px-4 py-2.5 sm:flex">
            <Search size={14} strokeWidth={1.9} className="text-mc-muted" />
            <input
              type="search"
              placeholder="Buscar lead…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[200px] bg-transparent text-[13px] text-mc-text placeholder:text-mc-muted focus:outline-none"
            />
          </div>

          {/* Filter pills */}
          {(["all", "mine"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setViewFilter(key)}
              className={cn(
                "rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
                viewFilter === key
                  ? "bg-mc-rail text-white"
                  : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
              )}
            >
              {key === "all" ? "Todos" : "Meus leads"}
            </button>
          ))}

          {/* Add lead button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-mc-base px-4 py-2.5 text-[13px] font-semibold text-white transition-colors active:scale-[0.98]"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            <Plus size={16} strokeWidth={2} />
            Novo lead
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-5 p-6" style={{ minWidth: "max-content" }}>
          {columns.map((col, i) => (
            <KanbanColumn
              key={col.id}
              title={col.title}
              dotColor={col.dotColor}
              leads={col.leads}
              index={i}
            />
          ))}

          {/* Add column placeholder */}
          {activeFunnel && (
            <div className="flex h-full w-[56px] shrink-0 items-start pt-1">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-mc-base border border-dashed border-mc-border text-mc-muted transition hover:border-mc-text hover:text-mc-text"
                aria-label="Adicionar coluna"
              >
                <Plus size={18} strokeWidth={1.9} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
