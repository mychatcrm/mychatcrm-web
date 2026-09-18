"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  BookmarkPlus,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/lib/client-auth";
import { bucketMetaLeadEventStep } from "@/lib/meta-lead-event-status";
import {
  EMPTY_CENTRAL_FILTERS,
  META_LEAD_BUCKETS,
  META_LEAD_OUTCOMES,
  countActiveCentralFilters,
  parseCentralFilters,
  resolveDatePreset,
  serializeCentralFilters,
  type CentralDatePresetId,
  type MetaLeadBucketFilter,
  type MetaLeadCentralFilters,
  type MetaLeadOutcomeFilter,
} from "@/lib/meta-leads/central-filters";
import { OUTCOME_LABEL } from "@/lib/meta-leads/outcome-labels";
import { MultiSelectFilter, type MultiSelectOption } from "./MultiSelectFilter";
import { LeadDetailModal } from "./LeadDetailModal";
import { CampaignPerformancePanel } from "./CampaignPerformancePanel";
import { ReconciliationPanel } from "./ReconciliationPanel";
import { AlertsBanner } from "./AlertsBanner";

type CentralRow = {
  id: string;
  leadgen_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  page_id: string;
  page_name: string | null;
  form_id: string | null;
  form_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  lead_id: string | null;
  agent_id: string | null;
  crm_sync_status: string;
  whatsapp_status: string;
  current_step: string;
  error_message: string | null;
  created_at: string;
  archived_at?: string | null;
  outcome?: string | null;
  outcome_column?: string | null;
  outcome_owner?: string | null;
  outcome_first_reply_minutes?: number | null;
};

type SearchResponse = {
  rows?: CentralRow[];
  nextCursor?: string | null;
  total?: number | null;
  totalExact?: boolean;
  archiveSupported?: boolean;
  tableReady?: boolean;
  error?: string;
};

type Facets = {
  pages: MultiSelectOption[];
  forms: MultiSelectOption[];
  campaigns: MultiSelectOption[];
  adsets: MultiSelectOption[];
  ads: MultiSelectOption[];
  agents: MultiSelectOption[];
  truncated?: boolean;
};

const EMPTY_FACETS: Facets = { pages: [], forms: [], campaigns: [], adsets: [], ads: [], agents: [] };

const PAGE_SIZE = 50;
const SAVED_VIEWS_KEY = "mychatcrm-central-leads-views-v1";

const DATE_PRESETS: { id: CentralDatePresetId; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "mes_anterior", label: "Mês passado" },
];

const BUCKET_LABEL: Record<MetaLeadBucketFilter, string> = {
  novo: "Novo",
  ok: "OK",
  sem_regra: "Sem regra",
  erro: "Erro",
};

const BUCKET_STYLE: Record<string, string> = {
  novo: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sem_regra: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
  erro: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

type SavedView = { id: string; name: string; query: string };

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is SavedView =>
            Boolean(item) &&
            typeof (item as SavedView).id === "string" &&
            typeof (item as SavedView).name === "string" &&
            typeof (item as SavedView).query === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedView[]): void {
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views.slice(0, 20)));
  } catch {
    /* modo privado: a vista não persiste, o filtro continua a funcionar */
  }
}

function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Central de Leads — a base inteira dos formulários Meta conectados.
 *
 * Diferença de fundo para a aba "Leads recebidos": aqui **nada** é filtrado no
 * navegador. Período, campanha, conjunto, anúncio, formulário, página, estado,
 * agente, busca e arquivamento viram SQL, a paginação é por keyset e o export
 * sai em streaming. É o que permite o cliente do plano Escala, com 15 mil leads
 * por mês, procurar um lead de três meses atrás.
 */
export function CentralDeLeadsPanel({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();

  const [filters, setFilters] = useState<MetaLeadCentralFilters>(() => {
    if (typeof window === "undefined") return EMPTY_CENTRAL_FILTERS;
    return parseCentralFilters(new URLSearchParams(window.location.search));
  });
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [rows, setRows] = useState<CentralRow[]>([]);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [total, setTotal] = useState<number | null>(null);
  const [totalExact, setTotalExact] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveSupported, setArchiveSupported] = useState(true);
  const [tableReady, setTableReady] = useState(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  const requestIdRef = useRef(0);

  useEffect(() => {
    setSavedViews(loadSavedViews());
  }, []);

  useEffect(() => {
    fetch("/api/client/lead-rules/agents", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { agents?: { id: string; nome: string }[] } | null) => {
        if (json?.agents) setAgentNames(new Map(json.agents.map((agent) => [agent.id, agent.nome])));
      })
      .catch(() => {});
  }, []);

  const queryString = useMemo(() => serializeCentralFilters(filters).toString(), [filters]);

  // A URL acompanha o filtro para o recorte ser partilhável, mas por
  // `history.replaceState`: `router.replace` remontaria o server component do
  // dashboard a cada tecla digitada na busca.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${queryString ? `?${queryString}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
  }, [queryString]);

  const fetchPage = useCallback(
    async (options: { append?: boolean; cursor?: string | null } = {}) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (options.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(queryString);
        params.set("limit", String(PAGE_SIZE));
        if (options.cursor) {
          params.set("cursor", options.cursor);
          params.set("total", "0");
        }
        const response = await fetch(`/api/client/meta/lead-events/search?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const json = (await response.json()) as SearchResponse;
        if (!response.ok) throw new Error(json.error ?? "Não foi possível carregar os leads.");
        // Resposta de um filtro que já mudou não pode sobrescrever a atual.
        if (requestIdRef.current !== requestId) return;

        setRows((previous) => (options.append ? [...previous, ...(json.rows ?? [])] : (json.rows ?? [])));
        setCursor(json.nextCursor ?? null);
        setArchiveSupported(json.archiveSupported !== false);
        setTableReady(json.tableReady !== false);
        if (!options.append) {
          setTotal(typeof json.total === "number" ? json.total : null);
          setTotalExact(json.totalExact !== false);
          setSelected(new Set());
        }
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar.");
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [queryString],
  );

  const fetchFacets = useCallback(async () => {
    try {
      const response = await fetch(`/api/client/meta/lead-events/facets?${queryString}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const json = (await response.json()) as Facets;
      setFacets({
        pages: json.pages ?? [],
        forms: json.forms ?? [],
        campaigns: json.campaigns ?? [],
        adsets: json.adsets ?? [],
        ads: json.ads ?? [],
        agents: json.agents ?? [],
        truncated: json.truncated,
      });
    } catch {
      /* filtro sem opções ainda funciona pela busca livre */
    }
  }, [queryString]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  // As opções só dependem do período e do arquivamento — refazê-las a cada
  // campanha marcada esvaziaria a própria lista que o utilizador está a usar.
  useEffect(() => {
    void fetchFacets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.archived, filters.timezone]);

  // Busca com atraso: cada tecla numa base grande não pode virar uma consulta.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === searchDraft ? current : { ...current, search: searchDraft }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const activeFilterCount = useMemo(() => countActiveCentralFilters(filters), [filters]);

  const agentOptions = useMemo(
    () =>
      facets.agents.map((option) => ({
        ...option,
        label: agentNames.get(option.value) ?? option.label,
      })),
    [facets.agents, agentNames],
  );

  const applyPreset = useCallback((preset: CentralDatePresetId) => {
    setFilters((current) => {
      const range = resolveDatePreset(preset, current.timezone);
      return { ...current, from: range.from, to: range.to };
    });
  }, []);

  const toggleBucket = useCallback((bucket: MetaLeadBucketFilter) => {
    setFilters((current) => ({
      ...current,
      buckets: current.buckets.includes(bucket)
        ? current.buckets.filter((item) => item !== bucket)
        : [...current.buckets, bucket],
    }));
  }, []);

  const clearAll = useCallback(() => {
    setSearchDraft("");
    setFilters((current) => ({ ...EMPTY_CENTRAL_FILTERS, timezone: current.timezone }));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((current) => (current.size === rows.length ? new Set() : new Set(rows.map((row) => row.id))));
  }, [rows]);

  const runBulk = useCallback(
    async (action: "archive" | "restore") => {
      if (selected.size === 0) return;
      setBulkBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/client/meta/lead-events/bulk", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ids: Array.from(selected) }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Não foi possível concluir a ação.");
        setSelected(new Set());
        await fetchPage();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro na ação em massa.");
      } finally {
        setBulkBusy(false);
      }
    },
    [selected, fetchPage],
  );

  const saveCurrentView = useCallback(() => {
    const name = window.prompt("Nome desta visão de filtros:");
    if (!name?.trim()) return;
    const next = [
      { id: `view-${Date.now()}`, name: name.trim().slice(0, 40), query: queryString },
      ...savedViews,
    ];
    setSavedViews(next);
    persistSavedViews(next);
  }, [queryString, savedViews]);

  const applySavedView = useCallback((view: SavedView) => {
    const parsed = parseCentralFilters(new URLSearchParams(view.query));
    setFilters(parsed);
    setSearchDraft(parsed.search);
  }, []);

  const removeSavedView = useCallback(
    (id: string) => {
      const next = savedViews.filter((view) => view.id !== id);
      setSavedViews(next);
      persistSavedViews(next);
    },
    [savedViews],
  );

  const exportHref = `/api/client/meta/lead-events/export?${queryString}`;

  return (
    <div className="space-y-5">
      <AlertsBanner />

      <ReconciliationPanel session={session} />

      <CampaignPerformancePanel filters={filters} queryString={queryString} />

      <section
        className={cn(
          "min-w-0 rounded-xl border p-4 sm:p-5",
          isLight ? "border-slate-200/80 bg-surface-deep" : "border-line/80 bg-surface-card/80",
        )}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-bold tracking-tight text-content sm:text-lg">
              Central de leads
            </h2>
            <p className="mt-1 text-[13px] text-content-muted">
              Todos os leads dos formulários Meta ligados à conta
              {total !== null ? (
                <>
                  {" "}
                  — <strong className="text-content">{total.toLocaleString("pt-BR")}</strong>
                  {totalExact ? "" : "+"} no recorte atual
                </>
              ) : null}
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={filtersOpen || activeFilterCount > 0 ? "secondary" : "outline"}
              size="sm"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Filter className="h-4 w-4" aria-hidden />
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Button>
            <a
              href={exportHref}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line/45 bg-surface-card/70 px-3 text-xs font-semibold text-content-secondary transition-colors hover:border-line/60 hover:text-content"
            >
              <Download className="h-4 w-4" aria-hidden />
              Exportar
            </a>
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchPage()} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              Atualizar
            </Button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5",
              isLight ? "border-slate-200 bg-white" : "border-line bg-surface-card",
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Buscar por nome, telefone ou e-mail"
              className="h-full w-full bg-transparent text-xs text-content outline-none placeholder:text-content-faint"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={() => setSearchDraft("")}
                className="shrink-0 text-content-muted hover:text-content"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>

          {META_LEAD_BUCKETS.map((bucket) => (
            <button
              key={bucket}
              type="button"
              onClick={() => toggleBucket(bucket)}
              className={cn(
                "h-9 rounded-lg border px-3 text-xs font-medium transition-colors",
                filters.buckets.includes(bucket)
                  ? BUCKET_STYLE[bucket]
                  : isLight
                    ? "border-slate-200 bg-white text-content-muted hover:text-content"
                    : "border-line bg-surface-card text-content-muted hover:text-content",
              )}
            >
              {BUCKET_LABEL[bucket]}
            </button>
          ))}
        </div>

        {filtersOpen ? (
          <div
            className={cn(
              "mb-4 space-y-4 rounded-xl border p-4",
              isLight ? "border-slate-200 bg-white/70" : "border-line/70 bg-surface-deep/40",
            )}
          >
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">Período</p>
              <div className="flex flex-wrap items-end gap-2">
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={cn(
                      "h-8 rounded-lg border px-2.5 text-xs transition-colors",
                      isLight
                        ? "border-slate-200 bg-white text-content-secondary hover:border-primary/40 hover:text-content"
                        : "border-line bg-surface-card text-content-secondary hover:border-primary/40 hover:text-content",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
                <label className="flex items-center gap-1.5 text-[11px] text-content-muted">
                  De
                  <input
                    type="date"
                    value={filters.from ?? ""}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, from: event.target.value || null }))
                    }
                    className="h-8 rounded-lg border border-line bg-surface-card px-2 text-xs text-content outline-none focus:border-primary/60"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-content-muted">
                  Até
                  <input
                    type="date"
                    value={filters.to ?? ""}
                    onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value || null }))}
                    className="h-8 rounded-lg border border-line bg-surface-card px-2 text-xs text-content outline-none focus:border-primary/60"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MultiSelectFilter
                label="Campanha"
                options={facets.campaigns}
                selected={filters.campaignIds}
                onChange={(values) => setFilters((current) => ({ ...current, campaignIds: values }))}
              />
              <MultiSelectFilter
                label="Conjunto de anúncios"
                options={facets.adsets}
                selected={filters.adsetIds}
                onChange={(values) => setFilters((current) => ({ ...current, adsetIds: values }))}
              />
              <MultiSelectFilter
                label="Anúncio"
                options={facets.ads}
                selected={filters.adIds}
                onChange={(values) => setFilters((current) => ({ ...current, adIds: values }))}
              />
              <MultiSelectFilter
                label="Formulário"
                options={facets.forms}
                selected={filters.formIds}
                onChange={(values) => setFilters((current) => ({ ...current, formIds: values }))}
              />
              <MultiSelectFilter
                label="Página"
                options={facets.pages}
                selected={filters.pageIds}
                onChange={(values) => setFilters((current) => ({ ...current, pageIds: values }))}
              />
              <MultiSelectFilter
                label="Agente"
                options={agentOptions}
                selected={filters.agentIds}
                onChange={(values) => setFilters((current) => ({ ...current, agentIds: values }))}
              />
            </div>

            <div className="border-t border-line/40 pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Resultado no CRM
              </p>
              <div className="flex flex-wrap gap-2">
                {META_LEAD_OUTCOMES.map((outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        outcomes: current.outcomes.includes(outcome)
                          ? current.outcomes.filter((item) => item !== outcome)
                          : [...current.outcomes, outcome as MetaLeadOutcomeFilter],
                      }))
                    }
                    className={cn(
                      "h-8 rounded-lg border px-2.5 text-xs transition-colors",
                      filters.outcomes.includes(outcome)
                        ? "border-primary/50 bg-primary/[0.08] text-primary"
                        : isLight
                          ? "border-slate-200 bg-white text-content-muted hover:text-content"
                          : "border-line bg-surface-card text-content-muted hover:text-content",
                    )}
                  >
                    {OUTCOME_LABEL[outcome] ?? outcome}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/40 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">Mostrar</span>
                {(
                  [
                    { id: "active", label: "Ativos" },
                    { id: "archived", label: "Arquivados" },
                    { id: "all", label: "Tudo" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilters((current) => ({ ...current, archived: option.id }))}
                    className={cn(
                      "h-8 rounded-lg border px-2.5 text-xs transition-colors",
                      filters.archived === option.id
                        ? "border-primary/50 bg-primary/[0.08] text-primary"
                        : isLight
                          ? "border-slate-200 bg-white text-content-muted"
                          : "border-line bg-surface-card text-content-muted",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={saveCurrentView}>
                  <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
                  Salvar visão
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearAll} disabled={activeFilterCount === 0}>
                  Limpar filtros
                </Button>
              </div>
            </div>

            {savedViews.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line/40 pt-3">
                <Bookmark className="h-3.5 w-3.5 text-content-muted" aria-hidden />
                {savedViews.map((view) => (
                  <span
                    key={view.id}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px]",
                      isLight ? "border-slate-200 bg-white" : "border-line bg-surface-card",
                    )}
                  >
                    <button type="button" onClick={() => applySavedView(view)} className="text-content hover:text-primary">
                      {view.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSavedView(view.id)}
                      aria-label={`Remover ${view.name}`}
                      className="text-content-faint hover:text-content"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {!archiveSupported ? (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Arquivamento indisponível: falta aplicar a migração do banco
            (<code>20260918000000_leads_central_v1</code>). A consulta e o export funcionam normalmente.
          </p>
        ) : null}

        {!tableReady ? (
          <p className="mb-3 rounded-lg border border-line bg-surface-elevated/40 px-3 py-2 text-xs text-content-muted">
            A inbox de leads Meta ainda não foi criada neste ambiente.
          </p>
        ) : null}

        {error ? (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {selected.size > 0 ? (
          <div
            className={cn(
              "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
              "border-primary/40 bg-primary/[0.06]",
            )}
          >
            <span className="text-xs font-medium text-content">{selected.size} selecionados</span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkBusy || !archiveSupported}
                onClick={() => void runBulk("archive")}
              >
                {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
                Arquivar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={bulkBusy || !archiveSupported}
                onClick={() => void runBulk("restore")}
              >
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                Restaurar
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            </div>
          </div>
        ) : null}

        <div className="min-w-0 overflow-x-auto">
          <table className="min-w-full divide-y divide-line/50 text-left text-sm">
            <thead className={cn(isLight ? "bg-slate-50" : "bg-surface-elevated/40")}>
              <tr>
                <th scope="col" className="w-9 px-2 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                </th>
                {["Entrada", "Lead", "Campanha", "Formulário", "Estado", "Resultado", "Atendimento"].map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-content-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-sm text-content-muted">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" aria-hidden />
                    Carregando leads…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-sm text-content-muted">
                    {activeFilterCount > 0
                      ? "Nenhum lead neste recorte. Ajuste os filtros."
                      : "Nenhum lead Meta recebido ainda."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const bucket = bucketMetaLeadEventStep(row.current_step);
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isLight ? "hover:bg-slate-50" : "hover:bg-surface-elevated/35",
                        row.archived_at ? "opacity-60" : "",
                      )}
                      onClick={() => setDetailId(row.id)}
                    >
                      <td className="px-2 py-2.5" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${row.name ?? row.leadgen_id}`}
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums text-content-muted">
                        {formatShortDateTime(row.created_at)}
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5">
                        <p className="truncate text-sm font-semibold text-content">{row.name || "Sem nome"}</p>
                        <p className="truncate text-[11px] text-content-muted">
                          {row.phone || "—"}
                          {row.email ? ` · ${row.email}` : ""}
                        </p>
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5">
                        <p className="truncate text-xs text-content">{row.campaign_name || "—"}</p>
                        <p className="truncate text-[11px] text-content-faint">{row.adset_name || row.ad_name || ""}</p>
                      </td>
                      <td className="max-w-[170px] truncate px-3 py-2.5 text-xs text-content-secondary">
                        {row.form_name || row.form_id || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge className={cn("text-[10px]", BUCKET_STYLE[bucket])}>
                          {BUCKET_LABEL[bucket as MetaLeadBucketFilter]}
                        </Badge>
                      </td>
                      <td className="max-w-[140px] px-3 py-2.5">
                        <p className="truncate text-xs text-content">
                          {row.outcome ? (OUTCOME_LABEL[row.outcome] ?? row.outcome) : "—"}
                        </p>
                        {row.outcome_column ? (
                          <p className="truncate text-[10px] text-content-faint">{row.outcome_column}</p>
                        ) : null}
                      </td>
                      <td className="max-w-[150px] truncate px-3 py-2.5 text-xs text-content-secondary">
                        {row.agent_id ? (agentNames.get(row.agent_id) ?? row.agent_id) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line/40 pt-3">
          <p className="text-xs text-content-muted">
            {rows.length.toLocaleString("pt-BR")} carregados
            {total !== null ? ` de ${total.toLocaleString("pt-BR")}${totalExact ? "" : "+"}` : ""}
          </p>
          {cursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={() => void fetchPage({ append: true, cursor })}
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Carregar mais
            </Button>
          ) : null}
        </div>
      </section>

      <LeadDetailModal
        eventId={detailId}
        onClose={() => setDetailId(null)}
        agentNames={agentNames}
        onArchivedChange={(id, archived) => {
          setRows((current) =>
            current.map((row) =>
              row.id === id ? { ...row, archived_at: archived ? new Date().toISOString() : null } : row,
            ),
          );
        }}
      />
    </div>
  );
}
