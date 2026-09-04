"use client";

import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search, TrendingUp } from "lucide-react";
import type { AdminSession } from "@/lib/admin-auth";
import type { PlatformMetricsPayload } from "@/lib/admin-platform-metrics";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RealClient = {
  id: string;
  name: string;
  email: string;
  planSlug: string;
  status: string;
  createdAt: string;
  stripeCustomerId: string | null;
};

type KpiCard = {
  label: string;
  value: string;
  delta: string;
  deltaUp: boolean;
  note: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

function fmtNum(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

const PALETTES = [
  { bg: "#fde4d3", fg: "#B22A00" },
  { bg: "#dbeafe", fg: "#1d4ed8" },
  { bg: "#dcfce7", fg: "#067a3c" },
  { bg: "#fae8ff", fg: "#a21caf" },
  { bg: "#fef3c7", fg: "#a16207" },
  { bg: "#e0e7ff", fg: "#4338ca" },
] as const;

function avatarPalette(name: string) {
  const code = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PALETTES[code % PALETTES.length]!;
}

const PLAN_STYLES: Record<string, { bg: string; fg: string; border?: string }> = {
  solo: { bg: "#f4f4f5", fg: "#52525b" },
  equipa: { bg: "#dbeafe", fg: "#1d4ed8" },
  escala: { bg: "#fae8ff", fg: "#86198f" },
  profissional: { bg: "#f4f4f5", fg: "#52525b" },
  master: { bg: "#dbeafe", fg: "#1d4ed8" },
  enterprise: { bg: "var(--rail)", fg: "#fff" },
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string; border: string; dot: string }> = {
  active: { label: "Ativo", bg: "#ecfdf3", fg: "#067a3c", border: "#c9efd6", dot: "#00A650" },
  trial: { label: "Trial", bg: "#fff4ee", fg: "#B22A00", border: "#f7ddcf", dot: "#F24400" },
  canceled: { label: "Cancelado", bg: "var(--surface-2)", fg: "var(--muted)", border: "var(--border)", dot: "#71717A" },
  past_due: { label: "Inadimplente", bg: "#fff1f2", fg: "#be123c", border: "#fecdd3", dot: "#e11d48" },
};

function planLabel(slug: string) {
  if (slug === "solo") return "Solo";
  if (slug === "equipa") return "Equipa";
  if (slug === "escala") return "Escala";
  if (slug.includes("master")) return "Master";
  if (slug.includes("enterprise")) return "Enterprise";
  return "Profissional";
}

function planStyleKey(slug: string) {
  if (slug === "solo" || slug === "equipa" || slug === "escala") return slug;
  if (slug.includes("master")) return "master";
  if (slug.includes("enterprise")) return "enterprise";
  return "profissional";
}

function statusMeta(status: string) {
  return STATUS_META[status] ?? STATUS_META["active"]!;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiStat({ card }: { card: KpiCard }) {
  return (
    <div className="rounded-mc-base border border-mc-border bg-mc-surface p-5">
      <p className="mb-3 text-[13px] font-semibold text-mc-muted">{card.label}</p>
      <p className="text-[28px] font-extrabold leading-none tracking-tight text-mc-text">{card.value}</p>
      <div className="mt-2.5 flex items-center gap-2">
        <span
          className="text-[12.5px] font-bold"
          style={{ color: card.deltaUp ? "#067a3c" : "#dc2626" }}
        >
          {card.delta}
        </span>
        <span className="text-[12px] text-mc-muted">{card.note}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminOverviewV2({ session }: { session: AdminSession }) {
  // KPI state (derived from platform-metrics)
  const [metrics, setMetrics] = useState<PlatformMetricsPayload | null>(null);

  // Clients table state
  const [clients, setClients] = useState<RealClient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "trial">("all");

  // Fetch KPIs
  useEffect(() => {
    fetch("/api/admin/platform-metrics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMetrics(d as PlatformMetricsPayload))
      .catch(() => {});
  }, []);

  // Fetch clients
  const fetchParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("q", search.trim());
    if (filterStatus !== "all") p.set("status", filterStatus);
    return p.toString();
  }, [search, filterStatus]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/clients?${fetchParams}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        setClients(data.clients ?? []);
        setTotal(data.total ?? 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [fetchParams]);

  // Derive KPI cards
  const kpis: KpiCard[] = useMemo(() => {
    const m = metrics;
    const activeCount = m?.kpis.workspacesActiveInPeriod ?? 0;
    const mrrBrl = m?.financial.mrrApproxBrl ?? 0;
    const growthPct = m?.kpis.growthVsPreviousPct ?? null;

    return [
      {
        label: "Clientes ativos",
        value: fmtNum(activeCount),
        delta: growthPct != null ? `${growthPct > 0 ? "+" : ""}${growthPct.toFixed(1)}%` : "—",
        deltaUp: (growthPct ?? 0) >= 0,
        note: "vs período anterior",
      },
      {
        label: "MRR",
        value: mrrBrl > 0 ? fmtBRL(mrrBrl) : "—",
        delta: growthPct != null ? `${growthPct > 0 ? "+" : ""}${growthPct.toFixed(1)}%` : "—",
        deltaUp: (growthPct ?? 0) >= 0,
        note: "recorrência mensal",
      },
      {
        label: "Em trial",
        value: m ? fmtNum(m.kpis.workspacesRegistered - activeCount) : "—",
        delta: "—",
        deltaUp: true,
        note: "workspaces em teste",
      },
      {
        label: "Churn mensal",
        value: "—",
        delta: "—",
        deltaUp: true,
        note: "sem dados de cohort",
      },
    ];
  }, [metrics]);

  const STATUS_FILTERS: { key: "all" | "active" | "trial"; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "active", label: "Ativos" },
    { key: "trial", label: "Trial" },
  ];

  return (
    <div className="min-h-full bg-mc-bg">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-mc-border bg-mc-surface px-8 py-5">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-mc-text">Painel administrativo</h1>
          <p className="mt-0.5 text-[13px] text-mc-muted">Gestão de clientes, planos e saúde do sistema.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-[#c9efd6] bg-[#ecfdf3] px-3.5 py-2">
            <span className="h-2 w-2 rounded-full bg-[#00A650]" />
            <span className="text-[12.5px] font-semibold text-[#067a3c]">Sistemas operacionais</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-mc-base px-4 py-2.5 text-[13.5px] font-semibold text-white active:scale-[0.98]"
            style={{ backgroundColor: "var(--color-brand)" }}
          >
            <Plus size={16} strokeWidth={2} />
            Novo cliente
          </button>
        </div>
      </div>

      <div className="px-8 py-7">
        {/* KPI row */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <KpiStat key={k.label} card={k} />
          ))}
        </div>

        {/* Clients table card */}
        <div className="overflow-hidden rounded-mc-base border border-mc-border bg-mc-surface">
          {/* Table toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mc-border px-6 py-5">
            <p className="text-[15px] font-bold text-mc-text">
              Clientes{" "}
              <span className="text-[13px] font-semibold text-mc-muted">
                · {fmtNum(total)} contas
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search */}
              <div className="flex items-center gap-2 rounded-mc-base bg-mc-surface-2 px-3.5 py-2.5">
                <Search size={14} strokeWidth={1.9} className="text-mc-muted" />
                <input
                  type="search"
                  placeholder="Buscar empresa ou e-mail…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-[220px] bg-transparent text-[13px] text-mc-text placeholder:text-mc-muted focus:outline-none"
                />
              </div>
              {/* Status filters */}
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilterStatus(f.key)}
                  className={cn(
                    "rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
                    filterStatus === f.key
                      ? "bg-mc-rail text-white"
                      : "bg-mc-surface-2 text-mc-muted hover:text-mc-text",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table head */}
          <div className="grid grid-cols-[2.4fr_1.1fr_1.2fr_1fr_0.5fr] gap-4 border-b border-mc-border bg-mc-surface-2 px-6 py-3.5">
            {["Empresa", "Plano", "Status", "Criado em", ""].map((h) => (
              <span
                key={h}
                className="text-[11px] font-bold uppercase tracking-wider text-mc-muted"
              >
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          {loading && (
            <div className="py-12 text-center text-[13px] text-mc-muted">A carregar…</div>
          )}
          {!loading && clients.length === 0 && (
            <div className="py-12 text-center text-[13px] text-mc-muted">Nenhum cliente encontrado.</div>
          )}
          {!loading &&
            clients.map((c) => {
              const pal = avatarPalette(c.name || c.email);
              const ps = PLAN_STYLES[planStyleKey(c.planSlug)] ?? PLAN_STYLES["profissional"]!;
              const sm = statusMeta(c.status);
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-[2.4fr_1.1fr_1.2fr_1fr_0.5fr] items-center gap-4 border-b border-mc-border px-6 py-4 last:border-b-0"
                >
                  {/* Company + email */}
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px] text-[13px] font-bold"
                      style={{ background: pal.bg, color: pal.fg }}
                    >
                      {initials(c.name || c.email)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-mc-text">{c.name || "—"}</p>
                      <p className="truncate text-[12.5px] text-mc-muted">{c.email}</p>
                    </div>
                  </div>
                  {/* Plan badge */}
                  <div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                      style={{ background: ps.bg, color: ps.fg }}
                    >
                      {planLabel(c.planSlug)}
                    </span>
                  </div>
                  {/* Status badge */}
                  <div>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                      style={{ background: sm.bg, color: sm.fg, border: `1px solid ${sm.border}` }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: sm.dot }} />
                      {sm.label}
                    </span>
                  </div>
                  {/* Created at */}
                  <p className="text-[13.5px] text-mc-muted">
                    {new Date(c.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                  {/* Actions */}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-mc-base text-mc-muted transition hover:bg-mc-surface-2 hover:text-mc-text"
                    >
                      <MoreHorizontal size={18} strokeWidth={1.9} />
                    </button>
                  </div>
                </div>
              );
            })}

          {/* Footer pagination */}
          <div className="flex items-center justify-between px-6 py-4">
            <span className="text-[13px] text-mc-muted">
              Mostrando {clients.length} de {fmtNum(total)} contas
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-mc-base bg-mc-surface-2 px-3.5 py-2 text-[13px] font-semibold text-mc-muted transition hover:text-mc-text"
              >
                Anterior
              </button>
              <button
                type="button"
                className="rounded-mc-base border border-mc-border bg-mc-surface px-3.5 py-2 text-[13px] font-semibold text-mc-text"
              >
                Próxima
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
