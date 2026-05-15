"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import type { ClientAgendaEvent } from "@/lib/agenda/client-event";
import { cn } from "@/lib/utils";
import { AgendaClearEventsModal } from "./AgendaClearEventsModal";
import { AgendaDisconnectModal } from "./AgendaDisconnectModal";
import { AgendaEventModal, type AgendaEventFormState } from "./AgendaEventModal";
import {
  AGENDA_BRAND,
  AGENDA_BRAND_HOVER,
  GRID_HOURS,
  HOUR_HEIGHT_PX,
  MONTHS_PT,
  WEEKDAYS_MINI,
  WEEKDAYS_SHORT,
  type AgendaViewMode,
} from "./agenda-constants";
import {
  addDays,
  addMonths,
  formatPeriodTitle,
  getMonthGrid,
  sameDay,
  startOfWeekSunday,
  toDatetimeLocalValue,
} from "./agenda-date-utils";
import { eventsForDay, layoutTimedEvents } from "./agenda-layout";
import { useAgendaData } from "./use-agenda-data";
import { useIsMobile } from "./use-is-mobile";

type QuickCreateState = { x: number; y: number; start: Date; end: Date } | null;
type DetailState = { event: ClientAgendaEvent; x: number; y: number } | null;

function eventColor(ev: ClientAgendaEvent) {
  return ev.color || AGENDA_BRAND;
}

function formToPayload(form: AgendaEventFormState) {
  return {
    title: form.title.trim(),
    startAt: new Date(form.startAt).toISOString(),
    endAt: new Date(form.endAt).toISOString(),
    description: form.description.trim() || undefined,
    location: form.location.trim() || undefined,
    meetLink: form.meetLink.trim() || undefined,
    attendeeEmail: form.attendeeEmail.trim() || undefined,
    color: form.color,
    notifyWa: form.notifyWa,
  };
}

export function AgendaHub() {
  const data = useAgendaData();
  const [view, setView] = useState<AgendaViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [listLimit, setListLimit] = useState(30);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientAgendaEvent | null>(null);
  const [modalInitial, setModalInitial] = useState<Partial<AgendaEventFormState>>();
  const [quick, setQuick] = useState<QuickCreateState>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [detail, setDetail] = useState<DetailState>(null);
  const [now, setNow] = useState(() => new Date());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [clearEventsOpen, setClearEventsOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void data.refreshEvents(searchOpen ? searchQ : undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchOpen, searchQ, data.refreshEvents]);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    return t;
  }, []);

  const periodTitle = formatPeriodTitle(view, anchor, selected);
  const weekStart = useMemo(() => startOfWeekSunday(selected), [selected]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const visibleWeekDays = useMemo(() => {
    if (view !== "week" || !isMobile) return weekDays;
    return [addDays(selected, -1), selected, addDays(selected, 1)];
  }, [view, isMobile, weekDays, selected]);
  const timeGridDays = view === "week" ? visibleWeekDays : [selected];
  const timeGridColCount = timeGridDays.length;
  const timeGridMinWidth = view === "week" ? 56 + timeGridColCount * 100 : undefined;
  const timeGridTemplate = view === "week"
    ? `56px repeat(${timeGridColCount}, minmax(100px, 1fr))`
    : "56px minmax(0, 1fr)";
  const monthGrid = useMemo(() => getMonthGrid(anchor.getFullYear(), anchor.getMonth()), [anchor]);

  const goToday = () => {
    const t = new Date();
    setAnchor(t);
    setSelected(t);
  };

  const navigate = (delta: number) => {
    if (view === "month" || view === "agenda") setAnchor((a) => addMonths(a, delta));
    else if (view === "week") setSelected((d) => addDays(d, isMobile ? delta : delta * 7));
    else setSelected((d) => addDays(d, delta));
  };

  const openCreateModal = (seed?: Partial<AgendaEventFormState>) => {
    setEditing(null);
    setModalInitial(seed);
    setModalOpen(true);
    setQuick(null);
  };

  const openEditModal = (ev: ClientAgendaEvent) => {
    setEditing(ev);
    setModalOpen(true);
    setDetail(null);
  };

  const onSaveForm = async (form: AgendaEventFormState) => {
    const payload = formToPayload(form);
    if (editing) await data.updateEvent(editing.id, payload);
    else await data.createEvent(payload);
  };

  const onQuickSave = async () => {
    if (!quick || !quickTitle.trim()) return;
    await data.createEvent({
      title: quickTitle.trim(),
      startAt: quick.start.toISOString(),
      endAt: quick.end.toISOString(),
    });
    setQuick(null);
    setQuickTitle("");
  };

  const onDeleteEvent = async (ev: ClientAgendaEvent) => {
    if (!window.confirm(`Cancelar o evento "${ev.title}"?`)) return;
    await data.deleteEvent(ev.id);
    setDetail(null);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await data.disconnectGoogle(false);
      setDisconnectOpen(false);
    } catch {
      data.setError("Não foi possível desconectar o Google Calendar.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleClearEvents = async () => {
    setClearing(true);
    try {
      await data.clearGoogleEvents();
      setClearEventsOpen(false);
    } catch {
      data.setError("Não foi possível limpar os eventos sincronizados.");
    } finally {
      setClearing(false);
    }
  };

  const onCellClick = (e: React.MouseEvent, day: Date, hour?: number) => {
    if ((e.target as HTMLElement).closest("[data-event-id]")) return;
    const start = new Date(day);
    if (hour !== undefined) {
      start.setHours(hour, 0, 0, 0);
    } else {
      start.setHours(9, 0, 0, 0);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setQuick({ x: e.clientX, y: e.clientY, start, end });
    setQuickTitle("");
    setSelected(day);
  };

  const onDragEnd = useCallback(
    async (ev: ClientAgendaEvent, day: Date, hour: number, minute: number) => {
      const duration = new Date(ev.endISO).getTime() - new Date(ev.startISO).getTime();
      const start = new Date(day);
      start.setHours(hour, minute, 0, 0);
      const end = new Date(start.getTime() + duration);
      await data.updateEvent(ev.id, {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      setDraggingId(null);
    },
    [data],
  );

  const nowLineTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT_PX;

  const sortedListEvents = useMemo(() => {
    const from = startOfWeekSunday(today);
    return [...data.events]
      .filter((e) => new Date(e.startISO) >= from)
      .sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
  }, [data.events, today]);

  const groupedList = useMemo(() => {
    const map = new Map<string, ClientAgendaEvent[]>();
    for (const ev of sortedListEvents.slice(0, listLimit)) {
      const key = new Date(ev.startISO).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return [...map.entries()];
  }, [sortedListEvents, listLimit]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden bg-white text-[#3c4043]">
      {/* Topbar: duas linhas em mobile para evitar cortes e scroll horizontal */}
      <header className="flex shrink-0 flex-col gap-2 border-b border-[#dadce0] px-2 py-2 md:flex-row md:flex-wrap md:items-center md:gap-2 md:px-3">
        <div className="flex min-w-0 w-full items-center gap-1 md:w-auto md:flex-1 md:gap-2">
          <button type="button" className="shrink-0 rounded-full p-1.5 hover:bg-[#f1f3f4] md:p-2" onClick={() => setSidebarOpen((v) => !v)} aria-label="Menu">
            <Menu className="size-5" />
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <Calendar className="size-5 md:size-6" style={{ color: AGENDA_BRAND }} />
            <span className="hidden text-[22px] font-normal text-[#3c4043] md:inline">Agenda</span>
          </div>
          <button
            type="button"
            onClick={goToday}
            className="shrink-0 rounded border border-[#dadce0] px-2 py-1 text-xs font-medium hover:bg-[#f1f3f4] md:px-4 md:py-1.5 md:text-sm"
          >
            Hoje
          </button>
          <div className="flex shrink-0 items-center">
            <button type="button" className="rounded-full p-1.5 hover:bg-[#f1f3f4] md:p-2" onClick={() => navigate(-1)} aria-label="Anterior">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" className="rounded-full p-1.5 hover:bg-[#f1f3f4] md:p-2" onClick={() => navigate(1)} aria-label="Próximo">
              <ChevronRight className="size-5" />
            </button>
          </div>
          <h1 className="min-w-0 flex-1 truncate text-sm font-normal capitalize text-[#3c4043] md:text-xl">{periodTitle}</h1>
        </div>
        <div className="flex w-full min-w-0 shrink-0 items-center justify-end gap-1.5 md:w-auto md:justify-end md:gap-2">
          {searchOpen ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 md:max-w-md">
              <input
                autoFocus
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Pesquisar eventos"
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#dadce0] px-2 text-sm outline-none focus:border-[#f24400] sm:px-3"
              />
              <button type="button" className="shrink-0 rounded-full p-2 hover:bg-[#f1f3f4]" onClick={() => { setSearchOpen(false); setSearchQ(""); void data.refreshEvents(); }}>
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button type="button" className="shrink-0 rounded-full p-2 hover:bg-[#f1f3f4]" onClick={() => setSearchOpen(true)} aria-label="Pesquisar">
              <Search className="size-5" />
            </button>
          )}
          <button
            type="button"
            className="shrink-0 rounded-full p-2 hover:bg-[#f1f3f4]"
            aria-label="Configurações"
            onClick={() => setSidebarOpen(true)}
          >
            <Settings className="size-5" />
          </button>
          <select
            value={view}
            onChange={(e) => setView(e.target.value as AgendaViewMode)}
            className="min-w-0 max-w-[46%] shrink rounded-lg border border-[#dadce0] bg-white px-2 py-1.5 text-xs md:max-w-none md:px-3 md:text-sm"
            aria-label="Vista do calendário"
          >
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mês</option>
            <option value="agenda">Agenda</option>
          </select>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar — desktop: in-flow; mobile: drawer so Google / Desconectar stay reachable */}
        {sidebarOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              aria-label="Fechar menu da agenda"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 flex w-[min(100vw-2rem,280px)] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[#dadce0] bg-white p-4 shadow-xl md:static md:z-auto md:w-[256px] md:shadow-none">
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="flex items-center gap-3 rounded-full px-6 py-3 text-sm font-medium text-white shadow-sm"
              style={{ backgroundColor: AGENDA_BRAND }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = AGENDA_BRAND_HOVER; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = AGENDA_BRAND; }}
            >
              <Plus className="size-5" />
              Criar
            </button>
            <div>
              <p className="mb-2 text-center text-xs font-medium text-[#70757a]">
                {MONTHS_PT[anchor.getMonth()].slice(0, 3)} {anchor.getFullYear()}
              </p>
              <div className="grid grid-cols-7 text-center text-[10px] text-[#70757a]">
                {WEEKDAYS_MINI.map((d, i) => (
                  <div key={`${d}-${i}`}>{d}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-px text-center text-[11px]">
                {monthGrid.map((cell, idx) => {
                  const isSel = sameDay(cell.date, selected);
                  const isTod = sameDay(cell.date, today);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => { setSelected(cell.date); if (!cell.inMonth) setAnchor(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1)); }}
                      className={cn(
                        "aspect-square rounded-full py-0.5",
                        !cell.inMonth && "text-[#70757a]/50",
                        isTod && !isSel && "font-bold text-[#f24400]",
                        isSel && "bg-[#f24400] font-medium text-white",
                        !isSel && "hover:bg-[#f1f3f4]",
                      )}
                    >
                      {cell.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-[#70757a]">Outros calendários</p>
              <div className="rounded-lg border border-[#dadce0] p-3 text-xs">
                {data.google.connected ? (
                  <>
                    <p className="font-medium text-[#3c4043]">{data.google.email || "Google Calendar"}</p>
                    {data.google.lastSyncISO ? (
                      <p className="mt-1 text-[10px] text-[#188038]">
                        Sincronizado · {new Date(data.google.lastSyncISO).toLocaleString("pt-BR")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void data.syncGoogle()} className="inline-flex items-center gap-1 rounded-full border border-[#dadce0] px-2 py-1 text-[11px] hover:bg-[#f1f3f4]">
                        {data.syncing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                        Sincronizar
                      </button>
                      <button type="button" onClick={() => setClearEventsOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-2 py-1 text-[10px] leading-tight text-amber-700 hover:bg-amber-50 sm:text-[11px]">
                        <Trash2 className="size-3 shrink-0" />
                        Limpar agenda sincronizada
                      </button>
                      <button type="button" onClick={() => setDisconnectOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-50">
                        <Unlink className="size-3" />
                        Desconectar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[#70757a]">Conecte o Google Calendar para sincronizar eventos.</p>
                    <button type="button" onClick={data.connectGoogle} className="mt-2 w-full rounded-full py-2 text-xs font-semibold text-white" style={{ backgroundColor: AGENDA_BRAND }}>
                      Conectar
                    </button>
                  </>
                )}
              </div>
            </div>
          </aside>
          </>
        ) : null}

        {/* Main */}
        <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden" ref={gridRef}>
          {data.loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-[#70757a]">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Carregando eventos…
            </div>
          ) : null}
          {data.error ? <p className="px-4 py-2 text-sm text-rose-600">{data.error}</p> : null}

          {searchOpen && searchQ.trim() ? (
            <div className="min-w-0 max-w-full p-3 md:p-4">
              <p className="mb-3 text-sm text-[#70757a]">{data.events.length} resultado(s)</p>
              <ul className="space-y-2">
                {data.events.map((ev) => (
                  <li key={ev.id}>
                    <button type="button" className="w-full rounded-lg border border-[#dadce0] px-3 py-2 text-left hover:bg-[#f1f3f4]" onClick={(e) => setDetail({ event: ev, x: e.clientX, y: e.clientY })}>
                      <span className="font-medium">{ev.title}</span>
                      <span className="mt-0.5 block text-xs text-[#70757a]">
                        {new Date(ev.startISO).toLocaleString("pt-BR")}
                        {ev.location ? ` · ${ev.location}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!searchOpen || !searchQ.trim() ? (
            <>
              {view === "month" ? (
                <div className="box-border w-full min-w-0 max-w-full p-1 sm:p-2">
                  <div className="grid w-full min-w-0 grid-cols-7 border-b border-[#dadce0]">
                    {WEEKDAYS_SHORT.map((d) => (
                      <div key={d} className="min-w-0 truncate py-1.5 text-center text-[9px] font-medium uppercase text-[#70757a] sm:py-2 sm:text-[11px]">
                        {d}
                      </div>
                    ))}
                  </div>
                  <div className="grid w-full min-w-0 grid-cols-7">
                    {monthGrid.map((cell, idx) => {
                      const dayEvents = eventsForDay(data.events, cell.date);
                      const isSel = sameDay(cell.date, selected);
                      const isTod = sameDay(cell.date, today);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => onCellClick(e, cell.date)}
                          className={cn(
                            "min-h-0 min-w-0 border-b border-r border-[#dadce0] p-0.5 text-left hover:bg-[#f1f3f4] sm:p-1",
                            "min-h-[56px] sm:min-h-[120px]",
                            !cell.inMonth && "bg-[#fafafa] text-[#70757a]",
                            isSel && "bg-[#fef0eb]",
                            isTod && "font-bold",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex size-6 items-center justify-center rounded-full text-xs sm:size-7 sm:text-sm",
                              isTod && "bg-[#f24400] text-white",
                            )}
                          >
                            {cell.label}
                          </span>
                          <div className="mt-0.5 space-y-0.5 sm:mt-1">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <div
                                key={ev.id}
                                data-event-id={ev.id}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setDetail({ event: ev, x: e.clientX, y: e.clientY }); }}
                                className="truncate rounded px-1 py-0.5 text-[9px] font-medium text-white sm:px-1.5 sm:text-[11px]"
                                style={{ backgroundColor: eventColor(ev) }}
                              >
                                {ev.title}
                              </div>
                            ))}
                            {dayEvents.length > 3 ? (
                              <div className="text-[8px] text-[#70757a] sm:text-[10px]">+{dayEvents.length - 3}</div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(view === "week" || view === "day") ? (
                <div className={cn("w-full min-w-0", view === "week" && "overflow-x-auto")}>
                  <div
                    className="relative w-full min-w-0"
                    style={view === "week" && timeGridMinWidth ? { minWidth: timeGridMinWidth } : undefined}
                  >
                    <div className="sticky top-0 z-10 grid min-w-0 border-b border-[#dadce0] bg-white" style={{ gridTemplateColumns: timeGridTemplate }}>
                      <div className="min-w-0" />
                      {timeGridDays.map((d) => (
                        <div key={d.toISOString()} className="min-w-[100px] border-l border-[#dadce0] py-2 text-center text-xs">
                        <div className="truncate uppercase text-[#70757a]">{WEEKDAYS_SHORT[d.getDay()]}</div>
                        <div className={cn("mx-auto mt-1 flex size-8 items-center justify-center rounded-full text-base sm:size-9 sm:text-lg", sameDay(d, today) && "bg-[#f24400] font-bold text-white")}>
                          {d.getDate()}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="relative grid w-full min-w-0" style={{ gridTemplateColumns: timeGridTemplate }}>
                    <div>
                      {Array.from({ length: GRID_HOURS }, (_, h) => (
                        <div key={h} className="relative border-b border-[#dadce0] pr-2 text-right text-[10px] text-[#70757a]" style={{ height: HOUR_HEIGHT_PX }}>
                          <span className="absolute -top-2 right-2">{h === 0 ? "" : `${h}:00`}</span>
                        </div>
                      ))}
                    </div>
                    {timeGridDays.map((day) => {
                      const positioned = layoutTimedEvents(data.events, day, HOUR_HEIGHT_PX);
                      return (
                        <div
                          key={day.toISOString()}
                          className="relative border-l border-[#dadce0]"
                          style={{ height: GRID_HOURS * HOUR_HEIGHT_PX }}
                          onClick={(e) => {
                            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                            const y = e.clientY - rect.top;
                            const totalMin = (y / HOUR_HEIGHT_PX) * 60;
                            const hour = Math.floor(totalMin / 60);
                            const minute = Math.floor((totalMin % 60) / 15) * 15;
                            const start = new Date(day);
                            start.setHours(hour, minute, 0, 0);
                            const end = new Date(start.getTime() + 60 * 60 * 1000);
                            setQuick({ x: e.clientX, y: e.clientY, start, end });
                            setQuickTitle("");
                          }}
                        >
                          {sameDay(day, today) ? (
                            <div className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-[#ea4335]" style={{ top: nowLineTop }}>
                              <span className="absolute -left-1 -top-1.5 size-2.5 rounded-full bg-[#ea4335]" />
                            </div>
                          ) : null}
                          {Array.from({ length: GRID_HOURS }, (_, h) => (
                            <div key={h} className="border-b border-[#f1f3f4]" style={{ height: HOUR_HEIGHT_PX }} />
                          ))}
                          {positioned.map((ev) => (
                            <div
                              key={ev.id}
                              data-event-id={ev.id}
                              draggable
                              onDragStart={() => setDraggingId(ev.id)}
                              onDragEnd={(e) => {
                                const col = (e.currentTarget.parentElement as HTMLDivElement);
                                const rect = col.getBoundingClientRect();
                                const y = e.clientY - rect.top;
                                const totalMin = Math.max(0, (y / HOUR_HEIGHT_PX) * 60);
                                const hour = Math.min(23, Math.floor(totalMin / 60));
                                const minute = Math.floor((totalMin % 60) / 15) * 15;
                                void onDragEnd(ev, day, hour, minute);
                              }}
                              onClick={(e) => { e.stopPropagation(); setDetail({ event: ev, x: e.clientX, y: e.clientY }); }}
                              className={cn(
                                "absolute z-10 cursor-pointer overflow-hidden rounded border border-white/30 px-1 py-0.5 text-[11px] font-medium text-white shadow-sm",
                                draggingId === ev.id && "opacity-70",
                              )}
                              style={{
                                top: ev.topPx,
                                height: Math.max(ev.heightPx, 18),
                                left: `calc(${(ev.col / ev.colCount) * 100}% + 2px)`,
                                width: `calc(${100 / ev.colCount}% - 4px)`,
                                backgroundColor: eventColor(ev),
                              }}
                            >
                              <span className="block truncate font-semibold">{ev.title}</span>
                              <span className="block truncate text-[10px] opacity-90">
                                {new Date(ev.startISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>
              ) : null}

              {view === "agenda" ? (
                <div className="w-full min-w-0 max-w-full box-border p-3 md:p-4">
                  {groupedList.map(([dayKey, items]) => (
                    <div key={dayKey} className="mb-6 min-w-0">
                      <h3 className="mb-2 break-words text-sm font-medium text-[#70757a]">
                        {new Date(items[0]!.startISO).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                      </h3>
                      <ul className="space-y-2">
                        {items.map((ev) => (
                          <li key={ev.id}>
                            <button
                              type="button"
                              className="flex w-full min-w-0 max-w-full flex-col gap-1 rounded-lg border border-[#dadce0] px-3 py-3 text-left hover:bg-[#f1f3f4] md:flex-row md:items-start md:gap-4 md:border-0 md:px-2 md:py-2"
                              onClick={(e) => setDetail({ event: ev, x: e.clientX, y: e.clientY })}
                            >
                              <span className="shrink-0 text-sm text-[#70757a] md:w-28">
                                {new Date(ev.startISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                {" – "}
                                {new Date(ev.endISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2 font-medium text-[#3c4043]">
                                  <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: eventColor(ev) }} />
                                  {ev.title}
                                </span>
                                {ev.location ? <span className="mt-0.5 block text-xs text-[#70757a]">{ev.location}</span> : null}
                                <span className="mt-0.5 block text-[10px] text-[#70757a]">{ev.calendarLabel}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {sortedListEvents.length > listLimit ? (
                    <button type="button" className="text-sm font-medium text-[#f24400] hover:underline" onClick={() => setListLimit((n) => n + 30)}>
                      Carregar mais eventos
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </main>
      </div>

      {/* Quick create popover */}
      {quick ? (
        <div className="fixed z-50 w-[280px] max-w-[calc(100vw-16px)] rounded-lg border border-[#dadce0] bg-white p-3 shadow-xl" style={{ left: Math.min(quick.x, window.innerWidth - 296), top: Math.min(quick.y, window.innerHeight - 200) }}>
          <input
            autoFocus
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Adicionar título"
            className="w-full border-b border-[#dadce0] pb-2 text-sm outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") void onQuickSave(); }}
          />
          <p className="mt-2 text-xs text-[#70757a]">
            {quick.start.toLocaleString("pt-BR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
          <div className="mt-3 flex justify-between gap-2">
            <button type="button" className="text-xs font-medium text-[#f24400] hover:underline" onClick={() => { openCreateModal({ title: quickTitle, startAt: toDatetimeLocalValue(quick.start), endAt: toDatetimeLocalValue(quick.end) }); }}>
              Mais opções
            </button>
            <button type="button" className="rounded px-3 py-1 text-xs text-[#70757a] hover:bg-[#f1f3f4]" onClick={() => setQuick(null)}>Fechar</button>
          </div>
        </div>
      ) : null}

      {/* Event detail popover */}
      {detail ? (
        <div className="fixed z-50 w-[300px] max-w-[calc(100vw-16px)] rounded-lg border border-[#dadce0] bg-white p-4 shadow-xl" style={{ left: Math.min(detail.x, window.innerWidth - 316), top: Math.min(detail.y, window.innerHeight - 240) }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: eventColor(detail.event) }} />
                <h3 className="truncate font-medium text-[#3c4043]">{detail.event.title}</h3>
              </div>
              <p className="mt-2 text-sm text-[#70757a]">
                {new Date(detail.event.startISO).toLocaleString("pt-BR")}
                {" – "}
                {new Date(detail.event.endISO).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
              {detail.event.location ? <p className="mt-1 text-sm text-[#70757a]">{detail.event.location}</p> : null}
            </div>
            <button type="button" className="rounded-full p-1 hover:bg-[#f1f3f4]" onClick={() => setDetail(null)}><X className="size-4" /></button>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="rounded-full p-2 hover:bg-[#f1f3f4]" onClick={() => openEditModal(detail.event)} aria-label="Editar">
              <Pencil className="size-4" />
            </button>
            <button type="button" className="rounded-full p-2 hover:bg-[#f1f3f4]" onClick={() => void onDeleteEvent(detail.event)} aria-label="Excluir">
              <Trash2 className="size-4 text-rose-600" />
            </button>
          </div>
        </div>
      ) : null}

      <AgendaDisconnectModal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        loading={disconnecting}
        onConfirm={() => void handleDisconnect()}
      />

      <AgendaClearEventsModal
        open={clearEventsOpen}
        onClose={() => setClearEventsOpen(false)}
        loading={clearing}
        onConfirm={() => void handleClearEvents()}
      />

      <AgendaEventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={onSaveForm}
        editing={editing}
        initial={modalInitial}
      />
    </div>
  );
}
