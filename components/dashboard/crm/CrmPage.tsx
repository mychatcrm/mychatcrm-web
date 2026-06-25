"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownUp,
  Building2,
  ChevronDown,
  Clock,
  Filter,
  FolderPlus,
  GripVertical,
  Inbox,
  Layers,
  ListMinus,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  User,
  X,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/DataTable";
import type { ClientSession } from "@/lib/client-auth";
import { filterLeadsForSession } from "@/lib/organization-hierarchy";
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import {
  loadTeamEmployees,
  TEAM_EMPLOYEES_UPDATED_EVENT,
  type TeamEmployee,
} from "@/lib/team-employees-storage";
import {
  getDashboardDataset,
  type ClientLead,
} from "@/lib/dashboard-data";
import {
  applyCrmLeadFilters,
  EMPTY_CRM_LEAD_FILTERS,
  type CrmLeadAppliedFilters,
} from "@/lib/crm-lead-filters";
import { cn, formatBRL } from "@/lib/utils";
import {
  appendCrmTimelineEvent,
  buildPipelineMoveItem,
  getLeadTimelineResolved,
  LEAD_EXTRAS_UPDATED_EVENT,
  loadLeadExtras,
} from "@/lib/crm-lead-extras";
import { computeLeadTemperature, type LeadTemperatureResult } from "@/lib/crm-lead-temperature";
import { funnelColumnTitle, normalizeColunaInicialForFunnel } from "@/lib/crm-funnels";
import {
  buildCrmVisibilityDiagnostics,
  normalizeLeadsForVisibleCrmFunnel,
  preferredDefaultCrmFunnelId,
} from "@/lib/crm-visible-leads";
import { getPlanMaxSalesFunnelsForSession, normalizeClientPlan } from "@/lib/plan-limits";
import {
  createCrmLeadInApi,
  deleteCrmLeadsInApi,
  deleteCrmLeadInApi,
  fetchCrmLeadsFromApi,
  loadCrmLeadsFromApiWithLocalMigration,
  loadCrmLeadsSnapshot,
  persistCrmLeadsSnapshot,
  runCrmLeadBulkActionInApi,
  subscribeToCrmLeadsRealtime,
  updateCrmLeadInApi,
} from "@/lib/crm-leads-storage";
import { LeadThermometerInline } from "./LeadThermometer";
import { CrmAddLeadModal } from "./CrmAddLeadModal";
import { CrmReorderStagesModal } from "./CrmReorderStagesModal";
import { CrmInsightsBar } from "./CrmInsightsBar";
import { CrmLeadWorkspaceModal } from "./CrmLeadWorkspaceModal";
import { phoneToWhatsAppWebHref, WhatsAppGlyph } from "./crm-phone";
import crmStyles from "./crm-premium.module.css";
import { useCrmFunnels } from "../CrmFunnelsContext";
import { typography } from "@/lib/typography";

const CRM_KANBAN_COL_PREFIX = "crm-kanban:";
/** Texto exato que o utilizador deve escrever para confirmar apagar um funil. */
const DELETE_FUNNEL_CONFIRM_TEXT = "QUERO APAGAR";

/** Reescreve a ordem dos leads numa coluna do funil (`funilId` + `status`) mantendo o resto da lista na mesma ordem. */
function reorderLeadsForFunnelColumn(
  prev: ClientLead[],
  funilId: string,
  status: string,
  orderedIds: string[],
  leadById: Map<string, ClientLead>,
): ClientLead[] {
  const out: ClientLead[] = [];
  let placed = false;
  for (const l of prev) {
    if (l.funilId !== funilId || l.status !== status) {
      out.push(l);
      continue;
    }
    if (!placed) {
      for (const id of orderedIds) {
        const node = leadById.get(id);
        if (node) out.push(node);
      }
      placed = true;
      continue;
    }
  }
  if (!placed && orderedIds.length) {
    for (const id of orderedIds) {
      const node = leadById.get(id);
      if (node) out.push(node);
    }
  }
  return out;
}

function crmStageTone(
  columnId: string,
  title: string,
  index: number,
): "cyan" | "blue" | "orange" | "amber" | "green" {
  const normalized = `${columnId} ${title}`.toLocaleLowerCase("pt-BR");
  if (normalized.includes("fechado") || normalized.includes("ganho")) return "green";
  if (normalized.includes("negocia")) return "amber";
  if (normalized.includes("proposta")) return "orange";
  if (normalized.includes("atendimento") || normalized.includes("contato")) return "blue";
  if (normalized.includes("novo") || normalized.includes("entrada")) return "cyan";
  return (["cyan", "blue", "orange", "amber"] as const)[index % 4]!;
}

function CrmKanbanColumn({
  columnId,
  title,
  leadCount,
  totalValue,
  tone,
  sortableIds,
  animationIndex,
  children,
}: {
  columnId: string;
  title: string;
  leadCount: number;
  totalValue: number;
  tone: "cyan" | "blue" | "orange" | "amber" | "green";
  sortableIds: string[];
  animationIndex: number;
  children: ReactNode;
}) {
  const id = `${CRM_KANBAN_COL_PREFIX}${columnId}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  const isClosedColumn = columnId === "fechado" || title.toLocaleLowerCase("pt-BR").includes("fechado");
  return (
    <div
      ref={setNodeRef}
      style={{ animationDelay: `${animationIndex * 50}ms` }}
      data-tone={tone}
      className={cn(
        "crm-kanban-column-enter shrink-0 grow-0 rounded-xl p-2",
        "transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5",
        "w-[min(86vw,16.5rem)] sm:w-64 lg:w-[16.5rem]",
        crmStyles.kanbanColumn,
        isClosedColumn && crmStyles.kanbanClosed,
        isOver && crmStyles.kanbanDropActive,
        isOver && "border-primary/45 bg-primary/[0.055] shadow-[0_24px_70px_-42px_rgba(242,68,0,0.55)] ring-primary/20",
      )}
    >
      <div
        className={cn(
          "mb-2 rounded-lg px-3 py-2.5 text-white",
          crmStyles.kanbanHeader,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-semibold tracking-tight text-white">{title}</p>
          <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            {leadCount}
          </span>
        </div>
        <p className="mt-1 text-lg font-medium tabular-nums tracking-[-0.03em] text-white/95">
          {formatBRL(totalValue)}
        </p>
      </div>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div
          className={cn(
            "min-h-[10rem] space-y-2 rounded-lg p-1 transition-colors duration-200",
            crmStyles.kanbanBody,
            isOver && "border-primary/35 bg-primary/[0.035]",
          )}
        >
          {leadCount === 0 ? (
            <div
              className={cn("flex min-h-[8rem] flex-col items-center justify-center gap-1.5 text-center text-content-faint", crmStyles.emptyState)}
              aria-hidden
            >
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full bg-mc-surface-2"
              >
                <Inbox className="h-3.5 w-3.5" strokeWidth={1.7} />
              </div>
              <span className="text-[9px] font-medium uppercase tracking-[0.12em]">Sem leads</span>
            </div>
          ) : null}
          {children}
        </div>
      </SortableContext>
    </div>
  );
}

function CrmKanbanLeadCard({
  lead,
  temperature,
  onOpen,
  selected,
  onToggleSelected,
  lastDragEndedAtRef,
}: {
  lead: ClientLead;
  temperature: LeadTemperatureResult;
  onOpen: (lead: ClientLead) => void;
  selected: boolean;
  onToggleSelected: (leadId: string) => void;
  lastDragEndedAtRef: MutableRefObject<number>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 40 : undefined,
  };
  const waWebHref = phoneToWhatsAppWebHref(lead.telefone);
  const leadInitials = lead.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR"))
    .join("") || "L";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-line/70 bg-surface-card/95 text-left outline-none",
        "cursor-grab active:cursor-grabbing",
        "transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out",
        crmStyles.leadCard,
        "hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_24px_58px_-42px_rgba(242,68,0,0.45)]",
        "focus-visible:ring-2 focus-visible:ring-primary/30",
        selected && crmStyles.leadCardSelected,
        isDragging && crmStyles.leadCardDragging,
        selected && "border-primary/55 bg-primary/[0.06] ring-2 ring-primary/25",
        isDragging && "z-40 cursor-grabbing opacity-[0.96] ring-2 ring-primary/35",
      )}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (Date.now() - lastDragEndedAtRef.current < 280) return;
        onOpen(lead);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(lead);
        }
      }}
    >
      <div className="relative p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold", crmStyles.leadAvatar)}>
            {leadInitials}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[13px] font-semibold leading-snug tracking-[-0.01em] text-content">{lead.nome}</p>
            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-content-muted">
              <Building2 className="h-3 w-3 shrink-0 opacity-65" strokeWidth={1.9} aria-hidden />
              <span className="truncate">{lead.empresa}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <GripVertical className="h-4 w-4 text-content-faint opacity-0 transition-opacity group-hover:opacity-70" strokeWidth={1.8} aria-hidden />
            <label
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md text-content-muted transition hover:bg-primary/10",
                selected && "bg-primary/10 text-content",
              )}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line text-primary focus:ring-primary/25"
                checked={selected}
                onChange={() => onToggleSelected(lead.id)}
                aria-label={`Selecionar lead ${lead.nome}`}
              />
              <span className="sr-only">Selecionar</span>
            </label>
          </div>
        </div>

        <div className={cn("mt-2.5 flex items-end justify-between gap-2 rounded-lg px-2.5 py-2", crmStyles.leadValueBand)}>
          <div>
            <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-content-faint">Oportunidade</p>
            <p className={cn("mt-0.5 text-[15px] font-bold tabular-nums tracking-[-0.025em]", crmStyles.leadValue)}>{formatBRL(lead.valor)}</p>
          </div>
          <LeadThermometerInline result={temperature} className="w-[4.5rem]" />
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <div className={cn("min-w-0 rounded-lg px-2 py-1.5", crmStyles.leadMetaTile)}>
            <div className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-content-faint">
              <Clock className="h-2.5 w-2.5 shrink-0" strokeWidth={2} aria-hidden />
              Contato
            </div>
            <p className="mt-1 truncate text-[10px] font-medium text-content-secondary">{lead.ultimoContato}</p>
          </div>
          <div className={cn("min-w-0 rounded-lg px-2 py-1.5", crmStyles.leadMetaTile)}>
            <div className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-content-faint">
              <User className="h-2.5 w-2.5 shrink-0" strokeWidth={2} aria-hidden />
              Responsável
            </div>
            <p className="mt-1 truncate text-[10px] font-medium text-content-secondary">{lead.responsavel}</p>
          </div>
        </div>

        <div className="mt-2.5 flex min-w-0 items-center gap-1.5">
          <span
            className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-[9px] font-semibold", crmStyles.agentChip)}
            title={`Agente IA a atender: ${lead.agenteAtendendo}`}
          >
            IA · {lead.agenteAtendendo}
          </span>
          <a
            href={waWebHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 max-w-[46%] shrink-0 items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 text-[9px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
            aria-label={`Abrir WhatsApp Web com ${lead.nome}`}
            title="Conversar no WhatsApp Web"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <WhatsAppGlyph className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{lead.telefone}</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export function CrmPage({
  dataset,
  session,
}: {
  dataset: ReturnType<typeof getDashboardDataset>;
  session: ClientSession;
}) {
  const {
    funnels,
    addFunnel,
    deleteFunnel,
    updateFunnel,
    appendFunnelColumn,
    removeFunnelColumn,
    resetToSafeDefaults,
  } = useCrmFunnels();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [pipelineFunilId, setPipelineFunilId] = useState<string>("");
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<ClientLead | null>(null);
  const [search, setSearch] = useState("");
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([]);
  const [lastCrmApiLeadCount, setLastCrmApiLeadCount] = useState(dataset.leads.length);
  // Initialize with server data to avoid SSR/hydration mismatch.
  // The useEffect below loads persisted localStorage data after mount.
  const [leads, setLeads] = useState<ClientLead[]>(() =>
    dataset.leads.map((l) => ({ ...l })),
  );
  const [leadsLoadedFromApi, setLeadsLoadedFromApi] = useState(false);
  const [newFunnelOpen, setNewFunnelOpen] = useState(false);
  const [newFunnelNome, setNewFunnelNome] = useState("");
  const [newFunnelErr, setNewFunnelErr] = useState("");
  const [deleteFunnelOpen, setDeleteFunnelOpen] = useState(false);
  const [deleteFunnelPhrase, setDeleteFunnelPhrase] = useState("");
  const [deleteFunnelLeadsMode, setDeleteFunnelLeadsMode] = useState<"migrate" | "remove">("migrate");
  const [deleteFunnelMigrateToId, setDeleteFunnelMigrateToId] = useState("");
  const [deleteFunnelErr, setDeleteFunnelErr] = useState("");
  const [deleteFunnelBusy, setDeleteFunnelBusy] = useState(false);
  const [removeColOpen, setRemoveColOpen] = useState(false);
  const [removeColId, setRemoveColId] = useState("");
  const [removeColErr, setRemoveColErr] = useState("");
  const [removeColBusy, setRemoveColBusy] = useState(false);
  const [renameColOpen, setRenameColOpen] = useState(false);
  const [renameColId, setRenameColId] = useState("");
  const [renameColTitle, setRenameColTitle] = useState("");
  const [renameColErr, setRenameColErr] = useState("");
  const [reorderStagesOpen, setReorderStagesOpen] = useState(false);
  const [crmFiltersOpen, setCrmFiltersOpen] = useState(false);
  const [funnelConfigOpen, setFunnelConfigOpen] = useState(false);
  const [crmShowMoreFilters, setCrmShowMoreFilters] = useState(false);
  const [crmAppliedFilters, setCrmAppliedFilters] = useState<CrmLeadAppliedFilters>(() => ({
    ...EMPTY_CRM_LEAD_FILTERS,
  }));
  const [crmDraftFilters, setCrmDraftFilters] = useState<CrmLeadAppliedFilters>(() => ({
    ...EMPTY_CRM_LEAD_FILTERS,
  }));
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set());
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const [bulkActionBusy, setBulkActionBusy] = useState<"assign" | "status" | "offer" | null>(null);
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  const [crmPipelineError, setCrmPipelineError] = useState<string | null>(null);
  const [assignAttendantOpen, setAssignAttendantOpen] = useState(false);
  const [assignAttendantId, setAssignAttendantId] = useState("");
  const [changeStatusOpen, setChangeStatusOpen] = useState(false);
  const [changeStatusId, setChangeStatusId] = useState("");
  const [activeOfferOpen, setActiveOfferOpen] = useState(false);
  const [activeOfferTitle, setActiveOfferTitle] = useState("");
  const [activeOfferSuccess, setActiveOfferSuccess] = useState<{ id: string; title: string } | null>(null);
  const [deleteLeadConfirm, setDeleteLeadConfirm] = useState<{ ids: string[]; names: string[] } | null>(null);
  const [deleteLeadError, setDeleteLeadError] = useState<string | null>(null);
  const [deleteLeadBusy, setDeleteLeadBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fallback = dataset.leads.map((l) => ({ ...l }));
    setLeadsLoadedFromApi(false);
    void loadCrmLeadsFromApiWithLocalMigration(dataset.tenantId, fallback)
      .then((remoteLeads) => {
        if (cancelled) return;
        const visibleLeads = normalizeLeadsForVisibleCrmFunnel(remoteLeads, funnels);
        setLastCrmApiLeadCount(remoteLeads.length);
        setLeads(visibleLeads);
        setLeadsLoadedFromApi(true);
      })
      .catch(() => {
        if (cancelled) return;
        const snapshot = normalizeLeadsForVisibleCrmFunnel(loadCrmLeadsSnapshot(dataset.tenantId, fallback), funnels);
        setLastCrmApiLeadCount(snapshot.length);
        setLeads(snapshot);
        setLeadsLoadedFromApi(true);
      });
    return () => {
      cancelled = true;
    };
    // Intencional: baseline do dataset ao mudar tenant; snapshot local/servidor continua se existir.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataset.leads omitido de propósito
  }, [dataset.tenantId, funnels]);

  useEffect(() => {
    void refreshTeamEmployeesFromApi(dataset.tenantId).then(() => setTeamEmployees(loadTeamEmployees(dataset.tenantId)));
  }, [dataset.tenantId]);

  useEffect(() => {
    const on = () => {
      void refreshTeamEmployeesFromApi(dataset.tenantId).then(() => setTeamEmployees(loadTeamEmployees(dataset.tenantId)));
    };
    window.addEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, on);
    return () => window.removeEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, on);
  }, [dataset.tenantId]);

  useEffect(() => {
    if (!leadsLoadedFromApi) return;
    const id = window.setTimeout(() => {
      persistCrmLeadsSnapshot(dataset.tenantId, leads);
    }, 400);
    return () => window.clearTimeout(id);
  }, [dataset.tenantId, leads, leadsLoadedFromApi]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeToCrmLeadsRealtime(dataset.tenantId, () => {
      void fetchCrmLeadsFromApi()
        .then((remoteLeads) => {
          if (cancelled) return;
          const visibleLeads = normalizeLeadsForVisibleCrmFunnel(remoteLeads, funnels);
          setLeads(visibleLeads);
          persistCrmLeadsSnapshot(dataset.tenantId, visibleLeads);
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [dataset.tenantId, funnels]);

  useEffect(() => {
    if (!funnels.length) return;
    setPipelineFunilId((prev) => (prev && funnels.some((f) => f.id === prev) ? prev : preferredDefaultCrmFunnelId(funnels)));
  }, [funnels]);

  const activeFunnel = useMemo(
    () => funnels.find((f) => f.id === pipelineFunilId) ?? funnels[0],
    [funnels, pipelineFunilId],
  );

  useEffect(() => {
    setSelectedLead((prev) => {
      if (!prev) return prev;
      return leads.find((l) => l.id === prev.id) ?? null;
    });
  }, [leads]);

  useEffect(() => {
    const currentIds = new Set(leads.map((lead) => lead.id));
    setSelectedLeadIds((prev) => {
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [leads]);

  useEffect(() => {
    setCrmAppliedFilters({ ...EMPTY_CRM_LEAD_FILTERS });
    setCrmDraftFilters({ ...EMPTY_CRM_LEAD_FILTERS });
    setCrmShowMoreFilters(false);
  }, [activeFunnel?.id]);

  useEffect(() => {
    setSelectedLeadIds(new Set());
    setBulkActionsOpen(false);
  }, [activeFunnel?.id, search, crmAppliedFilters]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!bulkActionsMenuRef.current?.contains(event.target as Node)) {
        setBulkActionsOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const lastKanbanDragEndedAtRef = useRef(0);
  const bulkActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const markKanbanDragUi = useCallback(() => {
    lastKanbanDragEndedAtRef.current = Date.now();
  }, []);

  const onKanbanDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !activeFunnel) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;

      const fid = activeFunnel.id;
      const allowed = activeFunnel.columns.map((c) => c.id);

      setLeads((prev) => {
        const activeLead = prev.find((l) => l.id === activeId);
        if (!activeLead || activeLead.funilId !== fid) return prev;

        if (overId.startsWith(CRM_KANBAN_COL_PREFIX)) {
          const targetStatus = overId.slice(CRM_KANBAN_COL_PREFIX.length);
          if (!allowed.includes(targetStatus)) return prev;
          if (activeLead.status === targetStatus) return prev;

          queueMicrotask(() => {
            appendCrmTimelineEvent({
              leadId: activeLead.id,
              lead: { ...activeLead, status: targetStatus },
              funnel: activeFunnel,
              item: buildPipelineMoveItem(activeLead.id, activeLead.status, targetStatus, activeFunnel),
            });
            void updateCrmLeadInApi(activeLead.id, { status: targetStatus, funilId: fid })
              .then(() => setCrmPipelineError(null))
              .catch(() => {
                setLeads((current) =>
                  current.map((l) => (l.id === activeLead.id ? { ...activeLead } : l)),
                );
                setCrmPipelineError("Não foi possível salvar a movimentação do lead. Tente novamente.");
              });
          });

          const moved = { ...activeLead, status: targetStatus };
          const rest = prev.filter((l) => l.id !== activeId);
          const byId = new Map(rest.map((l) => [l.id, l]));
          byId.set(moved.id, moved);
          const targetIds = rest.filter((l) => l.funilId === fid && l.status === targetStatus).map((l) => l.id);
          const newIds = [...targetIds, moved.id];
          return reorderLeadsForFunnelColumn(rest, fid, targetStatus, newIds, byId);
        }

        const overLead = prev.find((l) => l.id === overId);
        if (!overLead || overLead.funilId !== fid) return prev;
        const targetStatus = overLead.status;
        if (!allowed.includes(targetStatus)) return prev;

        if (activeLead.status === targetStatus) {
          const colIds = prev.filter((l) => l.funilId === fid && l.status === targetStatus).map((l) => l.id);
          const oldIdx = colIds.indexOf(activeId);
          const newIdx = colIds.indexOf(overId);
          if (oldIdx < 0 || newIdx < 0) return prev;
          const newIds = arrayMove(colIds, oldIdx, newIdx);
          return reorderLeadsForFunnelColumn(prev, fid, targetStatus, newIds, new Map(prev.map((l) => [l.id, l])));
        }

        if (activeLead.status !== targetStatus) {
          queueMicrotask(() => {
            appendCrmTimelineEvent({
              leadId: activeLead.id,
              lead: { ...activeLead, status: targetStatus },
              funnel: activeFunnel,
              item: buildPipelineMoveItem(activeLead.id, activeLead.status, targetStatus, activeFunnel),
            });
            void updateCrmLeadInApi(activeLead.id, { status: targetStatus, funilId: fid })
              .then(() => setCrmPipelineError(null))
              .catch(() => {
                setLeads((current) =>
                  current.map((l) => (l.id === activeLead.id ? { ...activeLead } : l)),
                );
                setCrmPipelineError("Não foi possível salvar a movimentação do lead. Tente novamente.");
              });
          });
        }

        const moved = { ...activeLead, status: targetStatus };
        const rest = prev.filter((l) => l.id !== activeId);
        const byId = new Map(rest.map((l) => [l.id, l]));
        byId.set(moved.id, moved);
        const targetIds = rest.filter((l) => l.funilId === fid && l.status === targetStatus).map((l) => l.id);
        const insertAt = targetIds.indexOf(overId);
        if (insertAt < 0) return prev;
        const newIds = [...targetIds.slice(0, insertAt), moved.id, ...targetIds.slice(insertAt)];
        return reorderLeadsForFunnelColumn(rest, fid, targetStatus, newIds, byId);
      });
    },
    [activeFunnel],
  );

  const searchFiltered = useMemo(
    () =>
      leads.filter((lead) =>
        `${lead.nome} ${lead.empresa} ${lead.tag} ${lead.agenteEntrada} ${lead.agenteAtendendo} ${lead.origem}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [leads, search],
  );

  const scopeFiltered = useMemo(
    () => filterLeadsForSession(session, teamEmployees, searchFiltered),
    [session, teamEmployees, searchFiltered],
  );

  const pipelineBase = useMemo(
    () => (activeFunnel ? scopeFiltered.filter((lead) => lead.funilId === activeFunnel.id) : []),
    [scopeFiltered, activeFunnel],
  );

  const crmFilterOptions = useMemo(() => {
    const responsaveis = new Set<string>();
    const origens = new Set<string>();
    const tags = new Set<string>();
    const agentesIa = new Set<string>();
    for (const lead of pipelineBase) {
      if (lead.responsavel.trim()) responsaveis.add(lead.responsavel);
      if (lead.origem.trim()) origens.add(lead.origem);
      if (lead.tag.trim()) tags.add(lead.tag);
      for (const t of lead.tags) if (t.trim()) tags.add(t);
      if (lead.agenteAtendendo.trim()) agentesIa.add(lead.agenteAtendendo);
    }
    return {
      responsaveis: [...responsaveis].sort((a, b) => a.localeCompare(b, "pt-BR")),
      origens: [...origens].sort((a, b) => a.localeCompare(b, "pt-BR")),
      tags: [...tags].sort((a, b) => a.localeCompare(b, "pt-BR")),
      agentesIa: [...agentesIa].sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  }, [pipelineBase]);

  const pipelineLeads = useMemo(
    () => applyCrmLeadFilters(pipelineBase, crmAppliedFilters),
    [pipelineBase, crmAppliedFilters],
  );

  const selectedVisibleLeadCount = useMemo(
    () => pipelineLeads.filter((lead) => selectedLeadIds.has(lead.id)).length,
    [pipelineLeads, selectedLeadIds],
  );
  const selectedLeadCount = selectedLeadIds.size;

  const toggleLeadSelected = useCallback((leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const clearLeadSelection = useCallback(() => {
    setSelectedLeadIds(new Set());
    setBulkActionsOpen(false);
  }, []);

  const toggleAllVisibleLeads = useCallback(() => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      const allVisibleSelected = pipelineLeads.length > 0 && pipelineLeads.every((lead) => next.has(lead.id));
      if (allVisibleSelected) {
        for (const lead of pipelineLeads) next.delete(lead.id);
      } else {
        for (const lead of pipelineLeads) next.add(lead.id);
      }
      return next;
    });
  }, [pipelineLeads]);

  const openDeleteSelectedLeadsConfirm = useCallback(() => {
    const ids = [...selectedLeadIds];
    if (!ids.length) return;
    const names = leads.filter((lead) => selectedLeadIds.has(lead.id)).map((lead) => lead.nome);
    setDeleteLeadError(null);
    setBulkActionsOpen(false);
    setDeleteLeadConfirm({ ids, names });
  }, [leads, selectedLeadIds]);

  const confirmDeleteLeads = useCallback(() => {
    if (!deleteLeadConfirm?.ids.length || deleteLeadBusy) return;
    const ids = [...deleteLeadConfirm.ids];
    const previousLeads = leads;
    setDeleteLeadBusy(true);
    setDeleteLeadError(null);
    setLeads((prev) => prev.filter((lead) => !ids.includes(lead.id)));
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setSelectedLead((prev) => (prev && ids.includes(prev.id) ? null : prev));

    const request = ids.length === 1 ? deleteCrmLeadInApi(ids[0]!) : deleteCrmLeadsInApi(ids).then(() => undefined);
    void request
      .then(async () => {
        const remoteLeads = await fetchCrmLeadsFromApi();
        const visibleLeads = normalizeLeadsForVisibleCrmFunnel(remoteLeads, funnels);
        setLastCrmApiLeadCount(remoteLeads.length);
        setLeads(visibleLeads);
        persistCrmLeadsSnapshot(dataset.tenantId, visibleLeads);
        setDeleteLeadConfirm(null);
        setDeleteLeadBusy(false);
      })
      .catch(() => {
        setLeads(previousLeads);
        setDeleteLeadError("Não foi possível apagar agora. Tente novamente em instantes.");
        setDeleteLeadBusy(false);
      });
  }, [dataset.tenantId, deleteLeadBusy, deleteLeadConfirm, funnels, leads]);

  const activeTeamEmployees = useMemo(
    () => teamEmployees.filter((employee) => employee.ativo && !employee.accountSuspended),
    [teamEmployees],
  );

  const openAssignAttendantModal = useCallback(() => {
    if (!selectedLeadIds.size) return;
    setBulkActionsOpen(false);
    setBulkActionError(null);
    setAssignAttendantId((prev) => prev || activeTeamEmployees[0]?.id || "");
    setAssignAttendantOpen(true);
  }, [activeTeamEmployees, selectedLeadIds.size]);

  const openChangeStatusModal = useCallback(() => {
    if (!selectedLeadIds.size || !activeFunnel) return;
    setBulkActionsOpen(false);
    setBulkActionError(null);
    setChangeStatusId((prev) => (prev && activeFunnel.columns.some((column) => column.id === prev) ? prev : activeFunnel.columns[0]?.id || ""));
    setChangeStatusOpen(true);
  }, [activeFunnel, selectedLeadIds.size]);

  const openActiveOfferModal = useCallback(() => {
    if (!selectedLeadIds.size) return;
    const date = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    setBulkActionsOpen(false);
    setBulkActionError(null);
    setActiveOfferTitle(`Oferta ativa - ${date}`);
    setActiveOfferOpen(true);
  }, [selectedLeadIds.size]);

  const confirmAssignAttendant = useCallback(() => {
    const ids = [...selectedLeadIds];
    if (!ids.length || !assignAttendantId || bulkActionBusy) return;
    const attendant = activeTeamEmployees.find((employee) => employee.id === assignAttendantId);
    if (!attendant) {
      setBulkActionError("Selecione um atendente ativo.");
      return;
    }
    setBulkActionBusy("assign");
    setBulkActionError(null);
    void runCrmLeadBulkActionInApi({
      action: "assign_attendant",
      leadIds: ids,
      payload: { employeeId: attendant.id },
    })
      .then(() => {
        setLeads((prev) =>
          prev.map((lead) =>
            ids.includes(lead.id)
              ? { ...lead, ownerEmployeeId: attendant.id, responsavel: attendant.nome }
              : lead,
          ),
        );
        setAssignAttendantOpen(false);
        clearLeadSelection();
      })
      .catch((error) => {
        setBulkActionError(error instanceof Error ? error.message : "Não foi possível atribuir atendente.");
      })
      .finally(() => setBulkActionBusy(null));
  }, [activeTeamEmployees, assignAttendantId, bulkActionBusy, clearLeadSelection, selectedLeadIds]);

  const confirmChangeStatus = useCallback(() => {
    const ids = [...selectedLeadIds];
    if (!ids.length || !activeFunnel || !changeStatusId || bulkActionBusy) return;
    const allowedStatusIds = activeFunnel.columns.map((column) => column.id);
    if (!allowedStatusIds.includes(changeStatusId)) {
      setBulkActionError("Selecione uma etapa válida.");
      return;
    }
    setBulkActionBusy("status");
    setBulkActionError(null);
    void runCrmLeadBulkActionInApi({
      action: "change_status",
      leadIds: ids,
      payload: { status: changeStatusId, funnelId: activeFunnel.id, allowedStatusIds },
    })
      .then(() => {
        setLeads((prev) =>
          prev.map((lead) =>
            ids.includes(lead.id)
              ? { ...lead, funilId: activeFunnel.id, status: changeStatusId }
              : lead,
          ),
        );
        setChangeStatusOpen(false);
        clearLeadSelection();
      })
      .catch((error) => {
        setBulkActionError(error instanceof Error ? error.message : "Não foi possível alterar status.");
      })
      .finally(() => setBulkActionBusy(null));
  }, [activeFunnel, bulkActionBusy, changeStatusId, clearLeadSelection, selectedLeadIds]);

  const confirmCreateActiveOffer = useCallback(() => {
    const ids = [...selectedLeadIds];
    const title = activeOfferTitle.trim();
    if (!ids.length || !title || bulkActionBusy) return;
    setBulkActionBusy("offer");
    setBulkActionError(null);
    void runCrmLeadBulkActionInApi({
      action: "convert_to_active_offer",
      leadIds: ids,
      payload: { title },
    })
      .then((result) => {
        if (result.offer) setActiveOfferSuccess({ id: result.offer.id, title: result.offer.title });
        setActiveOfferOpen(false);
        clearLeadSelection();
      })
      .catch((error) => {
        setBulkActionError(error instanceof Error ? error.message : "Não foi possível criar oferta ativa.");
      })
      .finally(() => setBulkActionBusy(null));
  }, [activeOfferTitle, bulkActionBusy, clearLeadSelection, selectedLeadIds]);

  const crmVisibilityLogKeyRef = useRef("");
  useEffect(() => {
    if (!leadsLoadedFromApi) return;
    const diagnostics = buildCrmVisibilityDiagnostics({
      receivedFromApi: lastCrmApiLeadCount,
      normalizedLeads: leads,
      searchFiltered,
      scopeFiltered,
      pipelineBase,
      pipelineLeads,
      activeFunnel,
      funnels,
    });
    const key = JSON.stringify(diagnostics);
    if (crmVisibilityLogKeyRef.current === key) return;
    crmVisibilityLogKeyRef.current = key;
    console.warn("[crm-leads-visibility]", diagnostics);
  }, [
    activeFunnel,
    funnels,
    lastCrmApiLeadCount,
    leads,
    leadsLoadedFromApi,
    pipelineBase,
    pipelineLeads,
    scopeFiltered,
    searchFiltered,
  ]);

  const [leadTempTick, setLeadTempTick] = useState(0);
  useEffect(() => {
    const fn = () => setLeadTempTick((n) => n + 1);
    window.addEventListener(LEAD_EXTRAS_UPDATED_EVENT, fn);
    return () => window.removeEventListener(LEAD_EXTRAS_UPDATED_EVENT, fn);
  }, []);

  const temperatureByLeadId = useMemo(() => {
    void leadTempTick;
    const store = loadLeadExtras();
    const map: Record<string, LeadTemperatureResult> = {};
    for (const l of pipelineLeads) {
      const fd = funnels.find((f) => f.id === l.funilId) ?? activeFunnel;
      map[l.id] = computeLeadTemperature(l, getLeadTimelineResolved(store, l), fd);
    }
    return map;
  }, [pipelineLeads, funnels, activeFunnel, leadTempTick]);

  const columns = useMemo((): Column<ClientLead>[] => {
    const tempOf = (row: ClientLead) => temperatureByLeadId[row.id]!;
    return [
      {
        key: "select",
        header: "",
        className: "w-12",
        render: (row) => (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line text-primary focus:ring-primary/25"
            checked={selectedLeadIds.has(row.id)}
            aria-label={`Selecionar lead ${row.nome}`}
            onChange={() => toggleLeadSelected(row.id)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        key: "termo",
        header: "Temp.",
        className: "w-[6.5rem]",
        render: (row) => <LeadThermometerInline result={tempOf(row)} />,
      },
      {
        key: "nome",
        header: "Lead",
        render: (row) => (
          <span className="font-medium text-content">{row.nome}</span>
        ),
      },
      { key: "empresa", header: "Empresa", render: (row) => row.empresa },
      { key: "origem", header: "Origem", render: (row) => row.origem },
      {
        key: "status",
        header: "Etapa",
        render: (row) => funnelColumnTitle(activeFunnel, row.status),
      },
      { key: "agenteAtendendo", header: "Agente IA", render: (row) => row.agenteAtendendo },
      { key: "responsavel", header: "Atendente", render: (row) => row.responsavel },
      { key: "valor", header: "Valor", render: (row) => formatBRL(row.valor) },
    ];
  }, [temperatureByLeadId, activeFunnel, selectedLeadIds, toggleLeadSelected]);

  const toggleCrmFiltersPanel = useCallback(() => {
    setCrmFiltersOpen((open) => {
      if (!open) setCrmDraftFilters({ ...crmAppliedFilters });
      return !open;
    });
  }, [crmAppliedFilters]);

  const applyCrmDraftFilters = useCallback(() => {
    setCrmAppliedFilters({ ...crmDraftFilters });
  }, [crmDraftFilters]);

  const clearCrmFilters = useCallback(() => {
    setCrmDraftFilters({ ...EMPTY_CRM_LEAD_FILTERS });
    setCrmAppliedFilters({ ...EMPTY_CRM_LEAD_FILTERS });
  }, []);

  const openRemoveColumnModal = useCallback(() => {
    if (!activeFunnel || activeFunnel.columns.length <= 2) return;
    const last = activeFunnel.columns[activeFunnel.columns.length - 1]!;
    setRemoveColId(last.id);
    setRemoveColOpen(true);
  }, [activeFunnel]);

  const openRenameColumnModal = useCallback(() => {
    if (!activeFunnel?.columns.length) return;
    const first = activeFunnel.columns[0]!;
    setRenameColId(first.id);
    setRenameColTitle(first.title);
    setRenameColErr("");
    setRenameColOpen(true);
  }, [activeFunnel]);

  const closeRenameColumnModal = useCallback(() => {
    setRenameColOpen(false);
    setRenameColId("");
    setRenameColTitle("");
    setRenameColErr("");
  }, []);

  const confirmRenameColumn = useCallback(() => {
    if (!activeFunnel || !renameColId) return;
    const trimmed = renameColTitle.trim();
    if (!trimmed) {
      setRenameColErr("Indique um nome para a etapa.");
      return;
    }
    updateFunnel(activeFunnel.id, {
      columns: activeFunnel.columns.map((c) => (c.id === renameColId ? { ...c, title: trimmed } : c)),
    });
    closeRenameColumnModal();
  }, [activeFunnel, closeRenameColumnModal, renameColId, renameColTitle, updateFunnel]);

  const confirmRemoveColumn = useCallback(async () => {
    if (!activeFunnel || !removeColId || activeFunnel.columns.length <= 2 || removeColBusy) return;
    const fallback = activeFunnel.columns.find((c) => c.id !== removeColId)?.id;
    if (!fallback) return;
    const fid = activeFunnel.id;
    const affected = leads.filter((l) => l.funilId === fid && l.status === removeColId);
    setRemoveColBusy(true);
    setRemoveColErr("");
    try {
      await Promise.all(
        affected.map((lead) => updateCrmLeadInApi(lead.id, { status: fallback, funilId: fid })),
      );
      setLeads((prev) =>
        prev.map((l) => (l.funilId === fid && l.status === removeColId ? { ...l, status: fallback } : l)),
      );
      removeFunnelColumn(fid, removeColId);
      setRemoveColOpen(false);
      setRemoveColId("");
    } catch {
      setRemoveColErr("Não foi possível migrar os leads desta etapa. A remoção foi cancelada.");
    } finally {
      setRemoveColBusy(false);
    }
  }, [activeFunnel, leads, removeColBusy, removeColId, removeFunnelColumn]);

  const closeDeleteFunnelModal = useCallback(() => {
    setDeleteFunnelOpen(false);
    setDeleteFunnelPhrase("");
    setDeleteFunnelLeadsMode("migrate");
    setDeleteFunnelMigrateToId("");
    setDeleteFunnelErr("");
    setDeleteFunnelBusy(false);
  }, []);

  const confirmDeleteFunnel = useCallback(async () => {
    if (deleteFunnelPhrase.trim() !== DELETE_FUNNEL_CONFIRM_TEXT || deleteFunnelBusy) return;
    if (funnels.length <= 1 || !activeFunnel) return;
    const sourceId = activeFunnel.id;
    setDeleteFunnelBusy(true);
    setDeleteFunnelErr("");

    try {
      if (deleteFunnelLeadsMode === "remove") {
        const removed = leads.filter((l) => l.funilId === sourceId);
        await Promise.all(removed.map((lead) => deleteCrmLeadInApi(lead.id)));
        setLeads((prev) => prev.filter((l) => l.funilId !== sourceId));
      } else {
        const targetFunnel = funnels.find((f) => f.id === deleteFunnelMigrateToId && f.id !== sourceId);
        if (!targetFunnel?.columns.length) {
          setDeleteFunnelErr("Selecione um funil de destino válido.");
          return;
        }
        const toMigrate = leads
          .filter((l) => l.funilId === sourceId)
          .map((l) => ({
            ...l,
            funilId: targetFunnel.id,
            status: normalizeColunaInicialForFunnel(l.status, targetFunnel),
          }));
        await Promise.all(
          toMigrate.map((lead) =>
            updateCrmLeadInApi(lead.id, { status: lead.status, funilId: lead.funilId }),
          ),
        );
        setLeads((prev) =>
          prev.map((l) => {
            if (l.funilId !== sourceId) return l;
            return {
              ...l,
              funilId: targetFunnel.id,
              status: normalizeColunaInicialForFunnel(l.status, targetFunnel),
            };
          }),
        );
      }

      deleteFunnel(sourceId);
      closeDeleteFunnelModal();
    } catch {
      setDeleteFunnelErr("Não foi possível concluir a operação nos leads. O funil não foi apagado.");
    } finally {
      setDeleteFunnelBusy(false);
    }
  }, [
    activeFunnel,
    closeDeleteFunnelModal,
    deleteFunnel,
    deleteFunnelBusy,
    deleteFunnelLeadsMode,
    deleteFunnelMigrateToId,
    deleteFunnelPhrase,
    funnels,
    leads,
  ]);

  const deleteFunnelMigrationTargets = useMemo(
    () => (activeFunnel ? funnels.filter((f) => f.id !== activeFunnel.id) : []),
    [activeFunnel, funnels],
  );

  const canConfirmDeleteFunnel =
    deleteFunnelPhrase.trim() === DELETE_FUNNEL_CONFIRM_TEXT &&
    (deleteFunnelLeadsMode === "remove" ||
      (deleteFunnelLeadsMode === "migrate" &&
        !!deleteFunnelMigrateToId &&
        deleteFunnelMigrationTargets.some((f) => f.id === deleteFunnelMigrateToId)));

  const planNormCrm = normalizeClientPlan(session.plan);
  const maxSalesFunnels = getPlanMaxSalesFunnelsForSession(session);

  const submitNewFunnel = useCallback(() => {
    setNewFunnelErr("");
    const trimmed = newFunnelNome.trim();
    if (!trimmed) {
      setNewFunnelErr("Indique um nome para o funil.");
      return;
    }
    if (funnels.length >= maxSalesFunnels) {
      setNewFunnelErr(
        `Limite do plano: até ${maxSalesFunnels} funis de vendas. Apague ou combine funis existentes, ou faça upgrade em /planos.`,
      );
      return;
    }
    const created = addFunnel(newFunnelNome);
    if (!created) {
      setNewFunnelErr(
        `Não foi possível criar o funil (teto: ${maxSalesFunnels}). Confira o nome ou o número de funis existentes.`,
      );
      return;
    }
    setPipelineFunilId(created.id);
    setNewFunnelNome("");
    setNewFunnelOpen(false);
  }, [addFunnel, newFunnelNome, funnels.length, maxSalesFunnels]);

  const crmSectionCard = cn(
    "min-w-0 rounded-[1.4rem] p-4 sm:p-5",
    crmStyles.insetPanel,
  );

  const crmViewToggle = (
    <div
      className={cn(
        "inline-flex shrink-0 rounded-xl p-0.5",
        crmStyles.viewToggle,
      )}
      role="group"
      aria-label="Vista do pipeline"
    >
      <button
        type="button"
        className={cn(
          "rounded-lg px-3 py-1.5 text-sm font-medium transition",
          view === "kanban"
            ? "bg-primary text-white shadow-[0_10px_26px_-18px_rgba(242,68,0,0.85)]"
            : "text-content-muted hover:bg-surface-elevated/60 hover:text-content",
        )}
        onClick={() => setView("kanban")}
      >
        CRM Kanban
      </button>
      <button
        type="button"
        className={cn(
          "rounded-lg px-3 py-1.5 text-sm font-medium transition",
          view === "lista"
            ? "bg-primary text-white shadow-[0_10px_26px_-18px_rgba(242,68,0,0.85)]"
            : "text-content-muted hover:bg-surface-elevated/60 hover:text-content",
        )}
        onClick={() => setView("lista")}
      >
        Lista
      </button>
    </div>
  );

  return (
    <div className={cn("space-y-4", crmStyles.theme, crmStyles.workspace)}>
      <section
        className={cn(
          "min-w-0 overflow-hidden rounded-mc-base border border-mc-border bg-mc-surface p-5 sm:p-6",
          crmStyles.mainShell,
        )}
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-[-0.025em] text-mc-text">CRM Kanban</h2>
          </div>
          {crmViewToggle}
        </div>
        <div className="space-y-4">
          <div className="min-w-0">
            <div
              className={cn(
                "relative flex flex-wrap items-center justify-between gap-2 rounded-2xl p-2.5 pb-4",
                crmStyles.toolbar,
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.12] text-primary", crmStyles.toolbarIcon)}>
                  <Layers className="h-4 w-4" strokeWidth={1.9} aria-hidden />
                </div>
                <div className="min-w-0 flex-1 sm:max-w-md">
                  <label className="sr-only" htmlFor="crm-pipeline-funil">
                    Funil ativo
                  </label>
                  <Select
                    id="crm-pipeline-funil"
                    className="h-10 min-h-0 w-full max-w-none truncate rounded-full border-mc-border bg-mc-surface/85 py-0 pl-4 pr-10 text-sm font-semibold text-mc-text shadow-inner"
                    value={activeFunnel?.id ?? ""}
                    title={activeFunnel?.nome ?? "Selecionar funil"}
                    onChange={(event) => setPipelineFunilId(event.target.value)}
                  >
                    {funnels.map((f) => (
                      <option key={f.id} value={f.id} className="bg-surface-card text-content">
                        {f.nome}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-content-muted",
                  crmStyles.countBadge,
                )}
              >
                {pipelineLeads.length} {pipelineLeads.length === 1 ? "lead visível" : "leads visíveis"}
              </span>
              <button
                type="button"
                onClick={() => setFunnelConfigOpen((open) => !open)}
                aria-expanded={funnelConfigOpen}
                aria-controls="crm-funnel-config-panel"
                aria-label={funnelConfigOpen ? "Fechar configurações do funil" : "Abrir configurações do funil"}
                title={funnelConfigOpen ? "Fechar configurações do funil" : "Abrir configurações do funil"}
                className={cn(
                  "absolute bottom-0 left-1/2 z-10 flex h-7 w-9 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full bg-mc-surface text-mc-muted opacity-70 ring-1 ring-mc-border transition-[opacity,background-color] duration-200 ease-out hover:bg-mc-surface-2 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
                  crmStyles.chevron,
                )}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200 ease-out",
                    funnelConfigOpen && "rotate-180",
                  )}
                  strokeWidth={1.8}
                  aria-hidden
                />
              </button>
            </div>

            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity,padding] duration-200 ease-out",
                funnelConfigOpen ? "grid-rows-[1fr] pt-4 opacity-100" : "grid-rows-[0fr] pt-0 opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden" inert={!funnelConfigOpen}>
                <section
                  id="crm-funnel-config-panel"
                  className={crmSectionCard}
                  aria-labelledby="crm-sec-funil-heading"
                  aria-hidden={!funnelConfigOpen}
                >
            <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl px-3 py-3", crmStyles.insetHeader)}>
              <div className="min-w-0">
                <h3 id="crm-sec-funil-heading" className={typography.ui.overline}>
                  Funil e etapas
                </h3>
                {activeFunnel ? (
                  <p className="mt-1 truncate text-base font-semibold text-content" title={activeFunnel.nome}>
                    {activeFunnel.nome}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-content-muted">Selecione um funil</p>
                )}
              </div>
              {activeFunnel ? (
                <div className="flex shrink-0 flex-wrap justify-start gap-2 sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Adicionar coluna ao fim do pipeline"
                    onClick={() => appendFunnelColumn(activeFunnel.id)}
                  >
                    <ListPlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Nova etapa
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Alterar o nome de uma etapa do CRM Kanban"
                    onClick={openRenameColumnModal}
                  >
                    <Pencil className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Renomear etapa
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Remover uma coluna (mínimo 2 etapas)"
                    disabled={activeFunnel.columns.length <= 2}
                    onClick={openRemoveColumnModal}
                  >
                    <ListMinus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Remover etapa
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    title="Mudar a ordem das colunas no CRM Kanban"
                    disabled={activeFunnel.columns.length < 2}
                    onClick={() => setReorderStagesOpen(true)}
                  >
                    <ArrowDownUp className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    Ordenar etapas
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
              <div className={cn("min-w-0 flex-1 rounded-2xl p-3", crmStyles.insetBlock)}>
                <p className="text-xs text-content-faint">Gestão de funis</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    title={
                      funnels.length >= maxSalesFunnels
                        ? `Limite do plano: ${maxSalesFunnels} funis`
                        : "Criar novo funil"
                    }
                    disabled={funnels.length >= maxSalesFunnels}
                    onClick={() => {
                      setNewFunnelErr("");
                      setNewFunnelNome("");
                      setNewFunnelOpen(true);
                    }}
                  >
                    <FolderPlus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="hidden sm:inline">Novo funil</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 gap-1.5 text-rose-500 hover:bg-rose-500/10"
                    title="Apagar funil selecionado"
                    disabled={funnels.length <= 1}
                    onClick={() => {
                      setDeleteFunnelPhrase("");
                      setDeleteFunnelLeadsMode("migrate");
                      const firstOther = funnels.find((f) => f.id !== activeFunnel?.id);
                      setDeleteFunnelMigrateToId(firstOther?.id ?? "");
                      setDeleteFunnelOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="hidden sm:inline">Apagar</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    title="Recria colunas oficiais (Novo Lead, Em atendimento…) e corrige funil salvo no navegador"
                    onClick={() => {
                      const ok = window.confirm(
                        "Restaurar colunas padrão do CRM?\n\nCustomizações de título das etapas oficiais serão sincronizadas. Etapas personalizadas (col-*) são mantidas.",
                      );
                      if (!ok) return;
                      resetToSafeDefaults();
                    }}
                  >
                    <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="hidden sm:inline">Sincronizar colunas</span>
                  </Button>
                </div>
              </div>
              {activeFunnel ? (
                <p className="text-xs leading-relaxed text-content-muted lg:max-w-[min(100%,22rem)] lg:self-end lg:pb-1 lg:text-right">
                  {activeFunnel.columns.length} etapas · «Ordenar etapas» muda a ordem das colunas. Arraste cartões no quadro
                  ou abra a ficha 360º.
                </p>
              ) : null}
            </div>
                </section>
              </div>
            </div>
          </div>

          {/* Área de trabalho CRM Kanban / Lista */}
          <section className="min-w-0" aria-labelledby="crm-sec-vista-heading">
            <div
              className={cn(
                "mb-3 space-y-2.5 rounded-2xl p-2.5 sm:p-3",
                crmStyles.actionSurface,
              )}
            >
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                {crmPipelineError ? (
                  <p className="w-full rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-500 lg:order-last lg:basis-full">
                    {crmPipelineError}
                  </p>
                ) : null}
                <div className="relative min-w-0 flex-1">
                  <label className="sr-only" htmlFor="crm-pipeline-busca">
                    Buscar leads
                  </label>
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint"
                    aria-hidden
                  />
                  <Input
                    id="crm-pipeline-busca"
                    className="h-10 min-h-0 rounded-xl py-0 pl-9 text-sm focus-visible:border-primary/45 focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_rgba(242,68,0,0.30)]"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar nome, empresa, tag ou origem"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-10 shrink-0 gap-1.5 rounded-xl px-3 py-0"
                    type="button"
                    disabled={!pipelineLeads.length}
                    onClick={toggleAllVisibleLeads}
                  >
                    {selectedVisibleLeadCount === pipelineLeads.length && pipelineLeads.length > 0 ? "Desmarcar" : "Selecionar"}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-10 shrink-0 gap-1.5 rounded-xl bg-gradient-to-b from-[#ff5722] to-primary px-4 py-0 font-semibold text-white shadow-[0_12px_28px_-18px_rgba(242,68,0,0.85)] transition hover:brightness-110"
                    type="button"
                    onClick={() => setAddLeadOpen(true)}
                  >
                    <Plus className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
                    Novo lead
                  </Button>
                  <button
                    type="button"
                    onClick={toggleCrmFiltersPanel}
                    aria-expanded={crmFiltersOpen}
                    aria-controls="crm-leads-filters-panel"
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-mc-brand/30 bg-mc-brand/[0.05] px-3 text-xs font-medium text-mc-brand transition hover:bg-mc-brand/[0.09] hover:text-mc-text"
                  >
                    <Filter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    Filtros
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 shrink-0 transition", crmFiltersOpen && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <h3
                  id="crm-sec-vista-heading"
                  className="text-sm font-semibold text-content-muted"
                  aria-label={`${view === "kanban" ? "Atendimentos" : "Tabela de leads"}, ${pipelineLeads.length} ${pipelineLeads.length === 1 ? "lead" : "leads"} visíveis`}
                >
                  {view === "kanban" ? "Quadro Kanban" : "Lista de leads"}
                </h3>
                <p className="text-xs text-content-faint">
                  {view === "kanban"
                    ? "Arraste entre colunas ou reordene na vertical."
                    : "Clique numa linha para abrir a ficha 360º."}
                </p>
              </div>

              {crmFiltersOpen && activeFunnel ? (
                <div
                  id="crm-leads-filters-panel"
                  className={cn(
                    "rounded-xl px-3 py-3 sm:px-4 sm:py-3",
                    crmStyles.filterPanel,
                  )}
                >
                  <p className="mb-2.5 text-[11px] leading-snug text-content-muted sm:hidden">
                    Ajuste os critérios e toque em «Aplicar filtros» para atualizar o quadro.
                  </p>

                  <div className="space-y-2.5">
                    {/* Linha 1: equipe + sem atendente + cliente */}
                    <div className="flex flex-wrap items-end gap-2 sm:gap-3">
                      <div className="w-[min(100%,11.5rem)] shrink-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-atendente"
                        >
                          Atendente
                        </label>
                        <Select
                          id="crm-filt-atendente"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.atendente}
                          onChange={(e) =>
                            setCrmDraftFilters((d) => ({ ...d, atendente: e.target.value, semAtendente: false }))
                          }
                        >
                          <option value="">Todos</option>
                          {crmFilterOptions.responsaveis.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div
                        className={cn(
                          "flex h-9 shrink-0 items-center gap-2 rounded-lg border border-mc-border bg-mc-surface-2/80 px-2.5",
                          crmStyles.filterSubsection,
                        )}
                        title="Mostrar apenas leads sem responsável definido"
                      >
                        <span className="hidden text-[11px] text-content-muted sm:inline">Sem atend.</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={crmDraftFilters.semAtendente}
                          id="crm-filt-sem-atendente"
                          onClick={() =>
                            setCrmDraftFilters((d) => ({
                              ...d,
                              semAtendente: !d.semAtendente,
                              atendente: !d.semAtendente ? "" : d.atendente,
                            }))
                          }
                          className={cn(
                            "relative h-5 w-9 shrink-0 rounded-full border transition",
                            crmDraftFilters.semAtendente
                              ? "border-primary/40 bg-primary/25"
                              : "border-line bg-surface-deep",
                          )}
                          aria-label="Filtrar apenas leads sem atendente"
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 h-4 w-4 rounded-full bg-content shadow transition",
                              crmDraftFilters.semAtendente ? "left-4" : "left-0.5",
                            )}
                          />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1 basis-[min(100%,16rem)]">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-cliente"
                        >
                          Cliente
                        </label>
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint"
                            aria-hidden
                          />
                          <Input
                            id="crm-filt-cliente"
                            className="min-h-9 rounded-lg py-1.5 pl-9 text-sm"
                            value={crmDraftFilters.clienteText}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, clienteText: e.target.value }))}
                            placeholder="Nome, e-mail, telefone…"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Linha 2: origem, tags, validade, termômetro, mídia */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-3">
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-tipo-midia"
                        >
                          Tipo de mídia
                        </label>
                        <Input
                          id="crm-filt-tipo-midia"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.tipoMidia}
                          onChange={(e) => setCrmDraftFilters((d) => ({ ...d, tipoMidia: e.target.value }))}
                          placeholder="Etiqueta…"
                          list="crm-filt-tipo-midia-list"
                          autoComplete="off"
                        />
                        <datalist id="crm-filt-tipo-midia-list">
                          {crmFilterOptions.tags.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-marketing"
                        >
                          Marketing
                        </label>
                        <Select
                          id="crm-filt-marketing"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.marketing}
                          onChange={(e) => setCrmDraftFilters((d) => ({ ...d, marketing: e.target.value }))}
                        >
                          <option value="">Todas as origens</option>
                          {crmFilterOptions.origens.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-tags"
                        >
                          Tags
                        </label>
                        <div className="relative">
                          <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint"
                            aria-hidden
                          />
                          <Input
                            id="crm-filt-tags"
                            className="min-h-9 rounded-lg py-1.5 pl-9 text-sm"
                            value={crmDraftFilters.tagAtendimento}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, tagAtendimento: e.target.value }))}
                            placeholder="Buscar…"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-validade"
                        >
                          Validade
                        </label>
                        <Select
                          id="crm-filt-validade"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.validade}
                          onChange={(e) =>
                            setCrmDraftFilters((d) => ({
                              ...d,
                              validade: e.target.value as CrmLeadAppliedFilters["validade"],
                            }))
                          }
                        >
                          <option value="todos">Todas</option>
                          <option value="com_proxima">Com próxima ação</option>
                          <option value="sem_proxima">Sem próxima ação</option>
                        </Select>
                      </div>
                      <div className="min-w-0 sm:col-span-1 lg:col-span-1">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-termometro"
                        >
                          Termômetro
                        </label>
                        <Select
                          id="crm-filt-termometro"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.termometro}
                          onChange={(e) =>
                            setCrmDraftFilters((d) => ({
                              ...d,
                              termometro: e.target.value as CrmLeadAppliedFilters["termometro"],
                            }))
                          }
                        >
                          <option value="todos">Todos</option>
                          <option value="quente">Quente</option>
                          <option value="morno">Morno</option>
                          <option value="frio">Frio</option>
                        </Select>
                      </div>
                    </div>

                    {/* Etapas: uma linha com scroll */}
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className={cn(typography.ui.overline, "text-content-faint")}>
                          Etapas do funil
                        </span>
                        <span className="text-[10px] text-content-muted" title="Sem seleção = todas as etapas visíveis">
                          {crmDraftFilters.kanbanStages.length
                            ? `${crmDraftFilters.kanbanStages.length} selecionada(s)`
                            : "Todas"}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "flex flex-nowrap gap-1 overflow-x-auto overscroll-x-contain rounded-lg border border-mc-border bg-mc-surface-2/60 px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] touch-pan-x [&::-webkit-scrollbar]:hidden",
                          crmStyles.filterSubsection,
                        )}
                        title="Sem caixa marcada = todas. Marque uma ou mais etapas para filtrar."
                      >
                        {activeFunnel.columns.map((col) => {
                          const checked = crmDraftFilters.kanbanStages.includes(col.id);
                          return (
                            <label
                              key={col.id}
                              className={cn(
                                "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
                                checked
                                  ? "border-primary/45 bg-primary/12 text-content"
                                  : "border-transparent bg-mc-surface text-mc-muted hover:border-mc-border",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-3 w-3 rounded border-line text-primary focus:ring-primary/25"
                                checked={checked}
                                onChange={() =>
                                  setCrmDraftFilters((d) => {
                                    const has = d.kanbanStages.includes(col.id);
                                    const kanbanStages = has
                                      ? d.kanbanStages.filter((x) => x !== col.id)
                                      : [...d.kanbanStages, col.id];
                                    return { ...d, kanbanStages };
                                  })
                                }
                              />
                              {col.title}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {crmShowMoreFilters ? (
                      <div className="max-w-md">
                        <label
                          className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                          htmlFor="crm-filt-agente-ia"
                        >
                          Agente IA
                        </label>
                        <Select
                          id="crm-filt-agente-ia"
                          className="min-h-9 rounded-lg py-1.5 text-sm"
                          value={crmDraftFilters.agenteIa}
                          onChange={(e) => setCrmDraftFilters((d) => ({ ...d, agenteIa: e.target.value }))}
                        >
                          <option value="">Todos</option>
                          {crmFilterOptions.agentesIa.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null}

                    <div
                      className={cn(
                        "rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3",
                        crmStyles.filterSubsection,
                      )}
                    >
                      <div className={cn("mb-2 text-amber-400/90 sm:mb-0 sm:mr-1 sm:self-center sm:pt-1", typography.ui.overline)}>
                        Datas
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                        <div className="min-w-0 sm:max-w-[11rem]">
                          <label
                            className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                            htmlFor="crm-filt-data-campo"
                          >
                            Campo
                          </label>
                          <Select
                            id="crm-filt-data-campo"
                            className="min-h-9 rounded-lg py-1.5 text-sm"
                            value={crmDraftFilters.dataConsiderar}
                            disabled
                          >
                            <option value="entrada">Entrada no CRM Kanban</option>
                          </Select>
                        </div>
                        <div className="min-w-0">
                          <label
                            className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                            htmlFor="crm-filt-periodo-de"
                          >
                            De
                          </label>
                          <Input
                            id="crm-filt-periodo-de"
                            type="date"
                            className="min-h-9 rounded-lg py-1.5 text-sm"
                            value={crmDraftFilters.periodoDe}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, periodoDe: e.target.value }))}
                          />
                        </div>
                        <div className="min-w-0">
                          <label
                            className={cn(typography.ui.overline, "mb-0.5 block text-content-faint")}
                            htmlFor="crm-filt-periodo-ate"
                          >
                            Até
                          </label>
                          <Input
                            id="crm-filt-periodo-ate"
                            type="date"
                            className="min-h-9 rounded-lg py-1.5 text-sm"
                            value={crmDraftFilters.periodoAte}
                            onChange={(e) => setCrmDraftFilters((d) => ({ ...d, periodoAte: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-line/50 pt-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 min-h-0 gap-1 rounded-lg px-3 py-1.5 text-xs"
                      onClick={() => setCrmShowMoreFilters((m) => !m)}
                      aria-expanded={crmShowMoreFilters}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Mais filtros
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-9 min-h-0 gap-1 rounded-lg px-3 py-1.5 text-xs"
                      onClick={clearCrmFilters}
                    >
                      <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Limpar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 min-h-0 gap-1 rounded-lg px-4 py-1.5 text-xs font-semibold"
                      onClick={applyCrmDraftFilters}
                    >
                      <Filter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Aplicar
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {activeFunnel ? (
              <section className="mb-3" aria-labelledby="crm-sec-metricas-heading">
                <h3 id="crm-sec-metricas-heading" className="sr-only">
                  Métricas do funil
                </h3>
                <CrmInsightsBar
                  compactTop
                  leads={pipelineLeads}
                  stageCount={activeFunnel.columns.length}
                  funnelName={activeFunnel.nome}
                  firstStageId={activeFunnel.columns[0]?.id ?? ""}
                />
              </section>
            ) : null}

            {view === "kanban" ? (
              <>
                <style jsx global>{`
                  @keyframes crm-kanban-column-enter {
                    from {
                      opacity: 0;
                      transform: translateY(8px);
                    }
                    to {
                      opacity: 1;
                      transform: translateY(0);
                    }
                  }

                  .crm-kanban-column-enter {
                    animation: crm-kanban-column-enter 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
                  }

                  @media (prefers-reduced-motion: reduce) {
                    .crm-kanban-column-enter {
                      animation: none;
                    }
                  }
                `}</style>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragEnd={(e) => {
                  markKanbanDragUi();
                  onKanbanDragEnd(e);
                }}
                onDragCancel={markKanbanDragUi}
                autoScroll={{ acceleration: 14, interval: 5 }}
              >
                <div
                  className={cn(
                    "flex w-full min-w-0 flex-nowrap gap-4 overflow-x-auto overflow-y-visible rounded-[1.35rem] p-3 pb-4 [-webkit-overflow-scrolling:touch] touch-pan-x",
                    crmStyles.kanbanViewport,
                  )}
                  aria-label="Colunas do funil — deslize para o lado para ver todas as etapas"
                >
                  {(activeFunnel?.columns ?? []).map((col, columnIndex) => {
                    const columnLeads = pipelineLeads.filter((lead) => lead.status === col.id);
                    const columnTotalValue = columnLeads.reduce((sum, lead) => sum + lead.valor, 0);
                    return (
                      <CrmKanbanColumn
                        key={col.id}
                        columnId={col.id}
                        title={col.title}
                        leadCount={columnLeads.length}
                        totalValue={columnTotalValue}
                        tone={crmStageTone(col.id, col.title, columnIndex)}
                        sortableIds={columnLeads.map((l) => l.id)}
                        animationIndex={columnIndex}
                      >
                        {columnLeads.map((lead) => (
                          <CrmKanbanLeadCard
                            key={lead.id}
                            lead={lead}
                            temperature={temperatureByLeadId[lead.id]!}
                            onOpen={setSelectedLead}
                            selected={selectedLeadIds.has(lead.id)}
                            onToggleSelected={toggleLeadSelected}
                            lastDragEndedAtRef={lastKanbanDragEndedAtRef}
                          />
                        ))}
                      </CrmKanbanColumn>
                    );
                  })}
                </div>
              </DndContext>
              </>
            ) : (
              <div className={cn("min-w-0 overflow-x-auto touch-pan-x", crmStyles.listSurface)}>
                <DataTable columns={columns} data={pipelineLeads} rowKey={(row) => row.id} onRowClick={setSelectedLead} />
              </div>
            )}
            {activeOfferSuccess ? (
              <div
                className={cn(
                  "mt-3 flex flex-col gap-2 rounded-[1.25rem] border border-emerald-500/25 bg-emerald-500/10 px-3 py-3 text-emerald-300 shadow-[0_18px_54px_-42px_rgba(16,185,129,0.65)] sm:flex-row sm:items-center sm:justify-between",
                  crmStyles.statusSurface,
                )}
              >
                <p className="text-sm font-medium">
                  Oferta ativa criada: {activeOfferSuccess.title}
                </p>
                <div className="flex gap-2">
                  <Link
                    className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-primary/[0.08] px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/[0.14]"
                    href={`/dashboard/ofertas-ativas?offer=${encodeURIComponent(activeOfferSuccess.id)}`}
                  >
                    Ver oferta ativa
                  </Link>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setActiveOfferSuccess(null)}>
                    Fechar
                  </Button>
                </div>
              </div>
            ) : null}
            {selectedLeadCount > 0 ? (
              <div
                className={cn(
                  "sticky bottom-3 z-30 mt-3 flex flex-col gap-2 rounded-[1.25rem] border border-mc-brand/25 bg-mc-surface/95 px-3 py-3 shadow-[0_24px_70px_-42px_rgba(242,68,0,0.5)] backdrop-blur sm:flex-row sm:items-center sm:justify-between",
                  crmStyles.selectionBar,
                )}
              >
                <p className="text-sm font-medium text-content">
                  {selectedLeadCount} {selectedLeadCount === 1 ? "lead selecionado" : "leads selecionados"}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center" ref={bulkActionsMenuRef}>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full gap-1.5 sm:w-auto"
                      onClick={() => setBulkActionsOpen((open) => !open)}
                      aria-expanded={bulkActionsOpen}
                    >
                      Ações em lote ({selectedLeadCount})
                      <ChevronDown className="h-4 w-4" strokeWidth={2} aria-hidden />
                    </Button>
                    {bulkActionsOpen ? (
                      <div
                        className="absolute bottom-full right-0 z-40 mb-2 w-64 overflow-hidden rounded-xl border border-mc-border bg-mc-surface p-1"
                      >
                        <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-content transition hover:bg-primary/10" onClick={openAssignAttendantModal}>
                          Atribuir atendente
                        </button>
                        <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-content transition hover:bg-primary/10" onClick={openChangeStatusModal}>
                          Alterar status
                        </button>
                        <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-content transition hover:bg-primary/10" onClick={openActiveOfferModal}>
                          Converter em oferta ativa
                        </button>
                        <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-500 transition hover:bg-rose-500/10" onClick={openDeleteSelectedLeadsConfirm}>
                          {selectedLeadCount === 1 ? "Excluir lead" : "Excluir leads"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={clearLeadSelection}>
                    Limpar seleção
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <Modal
        open={newFunnelOpen}
        onClose={() => {
          setNewFunnelOpen(false);
          setNewFunnelNome("");
          setNewFunnelErr("");
        }}
        title="Novo funil"
        className="max-w-md"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setNewFunnelOpen(false);
                setNewFunnelNome("");
                setNewFunnelErr("");
              }}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={submitNewFunnel}>
              Criar funil
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            O funil nasce com as mesmas etapas do modelo global. Depois pode usar «Nova etapa», «Renomear etapa», «Remover
            etapa» e «Ordenar etapas».
          </p>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-novo-funil-nome">
              Nome do funil
            </label>
            <Input
              id="crm-novo-funil-nome"
              value={newFunnelNome}
              onChange={(e) => setNewFunnelNome(e.target.value)}
              placeholder="Ex.: Inbound B2B · Campanha Q2"
              className="mt-1.5"
              autoComplete="off"
            />
          </div>
          {newFunnelErr ? <p className="text-sm text-rose-500">{newFunnelErr}</p> : null}
        </div>
      </Modal>

      <Modal
        open={deleteFunnelOpen && !!activeFunnel && funnels.length > 1}
        onClose={closeDeleteFunnelModal}
        title="Apagar funil"
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeDeleteFunnelModal}>
              Cancelar
            </Button>
            <Button variant="danger" type="button" disabled={!canConfirmDeleteFunnel || deleteFunnelBusy} onClick={() => void confirmDeleteFunnel()}>
              {deleteFunnelBusy ? "A processar…" : "Confirmar e apagar"}
            </Button>
          </>
        }
      >
        {activeFunnel ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-content-muted">
              O funil <span className="font-semibold text-content">{activeFunnel.nome}</span> deixa de existir. Escolha o
              que acontece aos leads que estão só neste funil. Esta ação não pode ser desfeita.
            </p>

            <fieldset className="min-w-0 space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-content-faint">Leads deste funil</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDeleteFunnelLeadsMode("migrate")}
                  className={cn(
                    "rounded-xl border p-3 text-left text-sm transition",
                    deleteFunnelLeadsMode === "migrate"
                      ? "border-primary bg-primary/8 ring-2 ring-primary/25"
                      : "border-line bg-surface-deep/20 hover:border-line",
                  )}
                >
                  <span className="font-semibold text-content">Mover para outro funil</span>
                  <p className="mt-1 text-xs leading-snug text-content-muted">
                    Os leads passam para o funil que escolher; a etapa é alinhada às colunas desse funil quando possível.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteFunnelLeadsMode("remove")}
                  className={cn(
                    "rounded-xl border p-3 text-left text-sm transition",
                    deleteFunnelLeadsMode === "remove"
                      ? "border-rose-500/50 bg-rose-500/[0.08] ring-2 ring-rose-500/20"
                      : "border-line bg-surface-deep/20 hover:border-line",
                  )}
                >
                  <span className="font-semibold text-content">Apagar leads</span>
                  <p className="mt-1 text-xs leading-snug text-content-muted">
                    Remove do CRM Kanban todos os leads associados apenas a este funil.
                  </p>
                </button>
              </div>
            </fieldset>

            {deleteFunnelLeadsMode === "migrate" ? (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-delete-funil-target">
                  Funil de destino
                </label>
                <Select
                  id="crm-delete-funil-target"
                  className="mt-1.5"
                  value={deleteFunnelMigrateToId}
                  onChange={(e) => setDeleteFunnelMigrateToId(e.target.value)}
                >
                  {deleteFunnelMigrationTargets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <p className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-xs text-content-muted">
                Os leads deste funil serão eliminados da lista. Confirme só se tiver a certeza.
              </p>
            )}

            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3">
              <p className="text-sm font-medium text-content">
                Para confirmar, escreva exatamente{" "}
                <span className="rounded bg-surface-deep/80 px-1.5 py-0.5 font-mono text-xs text-rose-400">
                  {DELETE_FUNNEL_CONFIRM_TEXT}
                </span>{" "}
                no campo abaixo e carregue em «Confirmar e apagar».
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-delete-funil-confirm">
                Confirmação por texto
              </label>
              <Input
                id="crm-delete-funil-confirm"
                value={deleteFunnelPhrase}
                onChange={(e) => setDeleteFunnelPhrase(e.target.value)}
                placeholder={DELETE_FUNNEL_CONFIRM_TEXT}
                className="mt-1.5 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={deleteFunnelPhrase.length > 0 && deleteFunnelPhrase.trim() !== DELETE_FUNNEL_CONFIRM_TEXT}
              />
            </div>
            {deleteFunnelErr ? <p className="text-sm text-rose-500">{deleteFunnelErr}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={renameColOpen && !!activeFunnel && activeFunnel.columns.length > 0}
        onClose={closeRenameColumnModal}
        title="Renomear etapa"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeRenameColumnModal}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmRenameColumn} disabled={!renameColTitle.trim()}>
              Guardar nome
            </Button>
          </>
        }
      >
        {activeFunnel ? (
          <div className="space-y-4">
            <p className="text-sm text-content-muted">
              O id interno da coluna mantém-se; só muda o título no CRM Kanban e na lista. Leads nesta etapa não são
              alterados.
            </p>
            <div>
              <label className="text-xs text-content-faint" htmlFor="crm-rename-col-select">
                Etapa
              </label>
              <Select
                id="crm-rename-col-select"
                className="mt-1"
                value={renameColId}
                onChange={(e) => {
                  const id = e.target.value;
                  setRenameColId(id);
                  const col = activeFunnel.columns.find((c) => c.id === id);
                  setRenameColTitle(col?.title ?? "");
                  setRenameColErr("");
                }}
              >
                {activeFunnel.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-content-faint" htmlFor="crm-rename-col-title">
                Novo nome
              </label>
              <Input
                id="crm-rename-col-title"
                value={renameColTitle}
                onChange={(e) => {
                  setRenameColTitle(e.target.value);
                  setRenameColErr("");
                }}
                placeholder="Nome visível no CRM Kanban"
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
            {renameColErr ? <p className="text-sm text-rose-500">{renameColErr}</p> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={removeColOpen && !!activeFunnel && activeFunnel.columns.length > 2}
        onClose={() => {
          setRemoveColOpen(false);
          setRemoveColId("");
          setRemoveColErr("");
        }}
        title="Remover etapa"
        className="max-w-md"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setRemoveColOpen(false);
                setRemoveColId("");
                setRemoveColErr("");
              }}
            >
              Cancelar
            </Button>
            <Button variant="danger" type="button" onClick={() => void confirmRemoveColumn()} disabled={!removeColId || removeColBusy}>
              {removeColBusy ? "A processar…" : "Remover etapa"}
            </Button>
          </>
        }
      >
        {activeFunnel ? (
          <div className="space-y-4">
            <p className="text-sm text-content-muted">
              Leads nesta etapa passam para outra coluna do mesmo funil. É obrigatório manter pelo menos duas etapas.
            </p>
            <div>
              <label className="text-xs text-content-faint" htmlFor="crm-remove-col-select">
                Etapa a remover
              </label>
              <Select
                id="crm-remove-col-select"
                className="mt-1"
                value={removeColId}
                onChange={(e) => setRemoveColId(e.target.value)}
              >
                {activeFunnel.columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </div>
            {removeColErr ? <p className="text-sm text-rose-500">{removeColErr}</p> : null}
          </div>
        ) : null}
      </Modal>

      <CrmReorderStagesModal
        open={reorderStagesOpen && !!activeFunnel && activeFunnel.columns.length > 0}
        onClose={() => setReorderStagesOpen(false)}
        columns={activeFunnel?.columns ?? []}
        onApply={(next) => {
          if (activeFunnel) updateFunnel(activeFunnel.id, { columns: next });
        }}
      />

      <Modal
        open={assignAttendantOpen}
        onClose={() => {
          if (bulkActionBusy) return;
          setAssignAttendantOpen(false);
          setBulkActionError(null);
        }}
        title="Atribuir atendente"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" type="button" disabled={!!bulkActionBusy} onClick={() => setAssignAttendantOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!assignAttendantId || !!bulkActionBusy} onClick={confirmAssignAttendant}>
              {bulkActionBusy === "assign" ? "Atribuindo..." : "Atribuir atendente"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            Escolha o atendente que ficará responsável por {selectedLeadCount} {selectedLeadCount === 1 ? "lead selecionado" : "leads selecionados"}.
          </p>
          <div>
            <label className="text-xs text-content-faint" htmlFor="crm-bulk-attendant">
              Atendente
            </label>
            <Select
              id="crm-bulk-attendant"
              className="mt-1"
              value={assignAttendantId}
              onChange={(event) => setAssignAttendantId(event.target.value)}
            >
              <option value="">Selecione um atendente</option>
              {activeTeamEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.nome}
                </option>
              ))}
            </Select>
          </div>
          {bulkActionError ? <p className="text-sm text-rose-500">{bulkActionError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={changeStatusOpen}
        onClose={() => {
          if (bulkActionBusy) return;
          setChangeStatusOpen(false);
          setBulkActionError(null);
        }}
        title="Alterar status"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" type="button" disabled={!!bulkActionBusy} onClick={() => setChangeStatusOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!changeStatusId || !!bulkActionBusy} onClick={confirmChangeStatus}>
              {bulkActionBusy === "status" ? "Alterando..." : "Alterar status"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            Os leads selecionados serão movidos dentro do funil ativo: {activeFunnel?.nome ?? "CRM"}.
          </p>
          <div>
            <label className="text-xs text-content-faint" htmlFor="crm-bulk-status">
              Etapa
            </label>
            <Select
              id="crm-bulk-status"
              className="mt-1"
              value={changeStatusId}
              onChange={(event) => setChangeStatusId(event.target.value)}
            >
              {(activeFunnel?.columns ?? []).map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </Select>
          </div>
          {bulkActionError ? <p className="text-sm text-rose-500">{bulkActionError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={activeOfferOpen}
        onClose={() => {
          if (bulkActionBusy) return;
          setActiveOfferOpen(false);
          setBulkActionError(null);
        }}
        title="Converter em oferta ativa"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" type="button" disabled={!!bulkActionBusy} onClick={() => setActiveOfferOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!activeOfferTitle.trim() || !!bulkActionBusy} onClick={confirmCreateActiveOffer}>
              {bulkActionBusy === "offer" ? "Criando..." : "Criar oferta ativa"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            Será criada uma oferta ativa vinculada a {selectedLeadCount} {selectedLeadCount === 1 ? "lead" : "leads"} do tenant atual.
          </p>
          <div>
            <label className="text-xs text-content-faint" htmlFor="crm-active-offer-title">
              Nome da oferta
            </label>
            <Input
              id="crm-active-offer-title"
              className="mt-1"
              value={activeOfferTitle}
              onChange={(event) => setActiveOfferTitle(event.target.value)}
              placeholder="Oferta ativa - 13/05/2026 14:30"
            />
          </div>
          {bulkActionError ? <p className="text-sm text-rose-500">{bulkActionError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={!!deleteLeadConfirm}
        onClose={() => {
          if (deleteLeadBusy) return;
          setDeleteLeadConfirm(null);
          setDeleteLeadError(null);
        }}
        title={deleteLeadConfirm?.ids.length === 1 ? "Apagar lead" : "Apagar leads selecionados"}
        className="max-w-md"
        footer={
          <>
            <Button
              variant="secondary"
              type="button"
              disabled={deleteLeadBusy}
              onClick={() => {
                setDeleteLeadConfirm(null);
                setDeleteLeadError(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="danger" type="button" disabled={deleteLeadBusy} onClick={confirmDeleteLeads}>
              {deleteLeadBusy ? "Apagando..." : "Apagar"}
            </Button>
          </>
        }
      >
        {deleteLeadConfirm ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-content-muted">
              {deleteLeadConfirm.ids.length === 1
                ? "Deseja excluir este lead permanentemente? Todo o histórico, mensagens, mídias, áudios, vídeos, imagens e registros vinculados serão apagados."
                : `Deseja excluir ${deleteLeadConfirm.ids.length} leads permanentemente? Todo o histórico, mensagens, mídias, áudios, vídeos, imagens e registros vinculados desses clientes serão apagados.`}
            </p>
            {deleteLeadConfirm.ids.length === 1 && deleteLeadConfirm.names[0] ? (
              <p className="rounded-lg border border-line bg-surface-deep/40 px-3 py-2 text-sm font-medium text-content">
                {deleteLeadConfirm.names[0]}
              </p>
            ) : null}
            {deleteLeadError ? (
              <p className="rounded-lg border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2 text-sm text-rose-500">
                {deleteLeadError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {selectedLead ? (
        <CrmLeadWorkspaceModal
          lead={selectedLead}
          funnel={activeFunnel}
          allFunnels={funnels}
          tenantId={dataset.tenantId}
          onClose={() => setSelectedLead(null)}
          onUpdateLead={(next) => {
            setLeads((prev) => prev.map((l) => (l.id === next.id ? next : l)));
            void updateCrmLeadInApi(next.id, next)
              .then((saved) => {
                if (saved) setLeads((prev) => prev.map((l) => (l.id === saved.id ? saved : l)));
              })
              .catch(() => undefined);
          }}
        />
      ) : null}
      <CrmAddLeadModal
        open={addLeadOpen}
        onClose={() => setAddLeadOpen(false)}
        funilId={activeFunnel?.id ?? pipelineFunilId}
        firstStageId={activeFunnel?.columns[0]?.id ?? "novo"}
        ownerEmployeeId={session.employeeId}
        responsavelLabel={
          session.organizationRole === "owner" || !session.employeeId ? "Equipe" : session.displayName
        }
        onCreate={(lead) => {
          setLeads((prev) => [lead, ...prev]);
          void createCrmLeadInApi(lead)
            .then((created) => setLeads((prev) => prev.map((l) => (l.id === lead.id ? created : l))))
            .catch(() => undefined);
        }}
      />
    </div>
  );
}
