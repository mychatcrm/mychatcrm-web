"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Unlink,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import {
  GOOGLE_AGENDA_LS_KEY,
  GOOGLE_AGENDA_UPDATED_EVENT,
  loadAgendaEvents,
  loadGoogleAgendaState,
  persistAgendaEvents,
  persistGoogleAgendaState,
  seedDemoAgendaEvents,
  type AgendaEventRecord,
  type GoogleAgendaLinkState,
} from "@/components/dashboard/agenda/agenda-storage";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"] as const;

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const GOOGLE_EMBED_HOLIDAYS =
  "https://calendar.google.com/calendar/embed?src=pt.brazilian%23holiday@group.v.calendar.google.com&ctz=America%2FSao_Paulo";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfWeekSunday(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Grade 6x7, domingo na primeira coluna (como Google Agenda web). */
function getMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: { label: number; inMonth: boolean; date: Date }[] = [];
  for (let i = 0; i < startPad; i++) {
    const day = prevDays - startPad + i + 1;
    cells.push({ label: day, inMonth: false, date: new Date(year, month - 1, day) });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ label: day, inMonth: true, date: new Date(year, month, day) });
  }
  const tail = 42 - cells.length;
  for (let i = 1; i <= tail; i++) {
    cells.push({ label: i, inMonth: false, date: new Date(year, month + 1, i) });
  }
  return cells;
}

function parseEventDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventBlocksForDay(events: AgendaEventRecord[], day: Date) {
  return events.filter((e) => {
    const s = parseEventDay(e.startISO);
    return s ? sameDay(s, day) : false;
  });
}

export function AgendaHub() {
  const { isLight } = usePanelAppearance();
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [anchor, setAnchor] = useState(() => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    return t;
  });
  const [selected, setSelected] = useState<Date | null>(() => new Date());
  const [events, setEvents] = useState<AgendaEventRecord[]>([]);
  const [google, setGoogle] = useState<GoogleAgendaLinkState>({ connected: false });
  const [syncing, setSyncing] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [kind, setKind] = useState("demo");
  const [meet, setMeet] = useState("");
  const [notifyWa, setNotifyWa] = useState(true);

  useEffect(() => {
    let list = loadAgendaEvents();
    if (list.length === 0) {
      list = seedDemoAgendaEvents();
      persistAgendaEvents(list);
    }
    setEvents(list);
    setGoogle(loadGoogleAgendaState());
  }, []);

  useEffect(() => {
    const sync = () => setGoogle(loadGoogleAgendaState());
    window.addEventListener(GOOGLE_AGENDA_UPDATED_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === GOOGLE_AGENDA_LS_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(GOOGLE_AGENDA_UPDATED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const persistEvents = useCallback((updater: AgendaEventRecord[] | ((prev: AgendaEventRecord[]) => AgendaEventRecord[])) => {
    setEvents((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persistAgendaEvents(next);
      return next;
    });
  }, []);

  const touchGoogleSync = useCallback(() => {
    const s = loadGoogleAgendaState();
    if (!s.connected) return;
    setSyncing(true);
    const next: GoogleAgendaLinkState = { ...s, lastSyncISO: new Date().toISOString() };
    setGoogle(next);
    persistGoogleAgendaState(next);
    window.setTimeout(() => setSyncing(false), 900);
  }, []);

  const onSaveEvent = useCallback(() => {
    if (!title.trim() || !start) return;
    const ev: AgendaEventRecord = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ev-${Date.now()}`,
      title: title.trim(),
      startISO: new Date(start).toISOString(),
      kind,
      meetLink: meet.trim() || undefined,
      notifyWa,
    };
    persistEvents((prev) => [ev, ...prev]);
    setTitle("");
    setMeet("");
    touchGoogleSync();
  }, [kind, meet, notifyWa, persistEvents, start, title, touchGoogleSync]);

  const connectGoogle = useCallback(() => {
    const next: GoogleAgendaLinkState = {
      connected: true,
      accountLabel: "conta Google (simulada)",
      lastSyncISO: new Date().toISOString(),
    };
    setGoogle(next);
    persistGoogleAgendaState(next);
  }, []);

  const disconnectGoogle = useCallback(() => {
    const next: GoogleAgendaLinkState = { connected: false };
    setGoogle(next);
    persistGoogleAgendaState(next);
  }, []);

  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const grid = useMemo(() => getMonthGrid(y, m), [y, m]);
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const weekStart = useMemo(() => startOfWeekSunday(selected ?? anchor), [selected, anchor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const hours = useMemo(() => Array.from({ length: 15 }, (_, i) => i + 7), []);

  const goMonth = (delta: number) => {
    const n = new Date(anchor);
    n.setMonth(n.getMonth() + delta);
    setAnchor(n);
  };

  const goToday = () => {
    const t = new Date();
    t.setHours(12, 0, 0, 0);
    setAnchor(t);
    setSelected(t);
  };

  const g = isLight
    ? {
        shell: "border-line bg-surface-deep text-content",
        topbar: "border-b border-line bg-surface-deep",
        btnGhost: "text-content-muted hover:bg-surface-elevated/60",
        btnPrimary: "bg-[#1a73e8] text-white hover:bg-[#1558b0]",
        btnOutline: "border border-line bg-surface-deep hover:bg-surface-elevated/60 text-content",
        cellHead: "text-content-muted text-[11px] font-medium uppercase tracking-wide",
        cell: "border border-line/60 bg-surface-deep hover:bg-surface-elevated/40",
        cellMuted: "border border-line/40 bg-surface-base text-content-faint",
        cellToday: "border border-[#1a73e8] bg-[#e8f0fe]/20",
        cellSelected: "border border-[#1a73e8] bg-[#d2e3fc]/20",
        sidebar: "border-r border-line bg-surface-deep",
        createBtn: "bg-[#1a73e8] text-white hover:bg-[#1558b0]",
        eventChip: "bg-[#1a73e8] text-white",
        timeCol: "text-content-faint text-[11px]",
        weekCol: "border-l border-line bg-surface-deep",
      }
    : {
        shell: "border-line bg-[#1e1f24] text-[#e8eaed]",
        topbar: "border-b border-[#444746] bg-[#1e1f24]",
        btnGhost: "text-[#c4c7c5] hover:bg-[#333537]",
        btnPrimary: "bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]",
        btnOutline: "border border-[#444746] bg-[#292a2d] hover:bg-[#333537] text-[#e8eaed]",
        cellHead: "text-[#9aa0a6] text-[11px] font-medium uppercase tracking-wide",
        cell: "border border-[#444746] bg-[#292a2d] hover:bg-[#333537]",
        cellMuted: "border border-[#333537] bg-[#202124] text-[#9aa0a6]",
        cellToday: "border border-[#8ab4f8] bg-[#394457]",
        cellSelected: "border border-[#8ab4f8] bg-[#3c4043]",
        sidebar: "border-r border-[#444746] bg-[#1e1f24]",
        createBtn: "bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]",
        eventChip: "bg-[#8ab4f8] text-[#202124]",
        timeCol: "text-[#9aa0a6] text-[11px]",
        weekCol: "border-l border-[#444746] bg-[#292a2d]",
      };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div
        className={cn(
          "min-w-0 overflow-hidden rounded-xl border font-sans tracking-normal sm:rounded-xl",
          g.shell,
        )}
      >
        <div className={cn("flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4", g.topbar)}>
          <button type="button" className={cn("rounded-full p-2", g.btnGhost)} aria-label="Menu">
            <CalendarIcon className="size-5" />
          </button>
          <button type="button" onClick={goToday} className={cn("rounded border px-3 py-1.5 text-sm font-medium", g.btnOutline)}>
            Hoje
          </button>
          <div className="flex items-center gap-0.5">
            <button type="button" className={cn("rounded-full p-2", g.btnGhost)} onClick={() => goMonth(-1)} aria-label="Mes anterior">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" className={cn("rounded-full p-2", g.btnGhost)} onClick={() => goMonth(1)} aria-label="Proximo mes">
              <ChevronRight className="size-5" />
            </button>
          </div>
          <h2 className="min-w-0 flex-1 truncate text-lg font-normal capitalize sm:text-xl">
            {MONTHS_PT[m]} de {y}
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={cn("rounded-full p-2", g.btnGhost)} aria-label="Pesquisar">
              <Search className="size-5" />
            </button>
            <button type="button" className={cn("rounded-full p-2", g.btnGhost)} aria-label="Configuracoes">
              <Settings className="size-5" />
            </button>
          </div>
          <div className="flex w-full justify-end gap-1 sm:w-auto">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm capitalize",
                  view === v ? g.btnPrimary : g.btnGhost,
                )}
              >
                {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-[520px] flex-col lg:flex-row">
          <aside className={cn("flex w-full flex-col gap-4 p-3 lg:w-[200px] lg:shrink-0", g.sidebar)}>
            <button
              type="button"
              className={cn("flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium", g.createBtn)}
              onClick={() => {
                const el = document.getElementById("agenda-novo-titulo");
                el?.focus();
              }}
            >
              <span className="text-lg leading-none">+</span> Criar
            </button>
            <div className="hidden lg:block">
              <div className="mb-2 text-center text-xs font-medium text-current/70">
                {MONTHS_PT[m].slice(0, 3)} {y}
              </div>
              <div className="grid grid-cols-7 gap-0 text-center text-[10px] text-current/60">
                {WEEKDAYS.map((d) => (
                  <div key={d}>{d[0]}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-px text-center text-[11px]">
                {getMonthGrid(y, m).map((cell, idx) => {
                  const isSel = selected && sameDay(cell.date, selected);
                  const isTod = sameDay(cell.date, today);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelected(cell.date);
                        if (!cell.inMonth) setAnchor(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                      }}
                      className={cn(
                        "aspect-square rounded-full py-0.5",
                        !cell.inMonth && "text-current/40",
                        isTod && cn("font-bold", isLight ? "text-[#1a73e8]" : "text-[#8ab4f8]"),
                        isSel && (isLight ? "bg-[#1a73e8] text-white" : "bg-[#8ab4f8] text-[#202124]"),
                        !isSel && !isTod && (isLight ? "hover:bg-black/5" : "hover:bg-white/10"),
                      )}
                    >
                      {cell.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-current/10 p-3 text-xs leading-snug text-current/80">
              <div className="mb-1 flex items-center gap-1 font-semibold text-current">
                <Link2 className="size-3.5" />
                Google Agenda
              </div>
              {google.connected ? (
                <>
                  <p className="text-current/70">Conta: {google.accountLabel}</p>
                  <p className="mt-1 text-[10px] text-current/60">
                    Em producao: OAuth 2.0 + Calendar API + sync incremental (webhook) mantem 100% alinhado ao Google.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href="https://calendar.google.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn("inline-flex items-center justify-center rounded-full border px-2 py-1 text-[11px] font-medium", g.btnOutline)}
                    >
                      Abrir Google
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        touchGoogleSync();
                      }}
                      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium", g.btnOutline)}
                    >
                      {syncing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                      Sincronizar
                    </button>
                    <button
                      type="button"
                      onClick={disconnectGoogle}
                      className={cn("inline-flex items-center gap-1 rounded-full border border-rose-500/40 px-2 py-1 text-[11px] font-medium", isLight ? "text-rose-600" : "text-rose-300")}
                    >
                      <Unlink className="size-3" />
                      Desconectar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-current/70">Conecte para espelhar eventos e ver o calendario Google aqui.</p>
                  <button type="button" onClick={connectGoogle} className={cn("mt-2 w-full rounded-full py-2 text-xs font-semibold", g.createBtn)}>
                    Conectar Google Agenda
                  </button>
                </>
              )}
            </div>
          </aside>

          <div className="min-h-[480px] min-w-0 flex-1 overflow-auto p-2 sm:p-3">
            {view === "month" ? (
              <div className="min-w-[320px]">
                <div className="grid grid-cols-7 gap-px">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className={cn("py-2 text-center", g.cellHead)}>
                      {d}
                    </div>
                  ))}
                  {grid.map((cell, idx) => {
                    const dayEvents = eventBlocksForDay(events, cell.date);
                    const isSel = selected && sameDay(cell.date, selected);
                    const isTod = sameDay(cell.date, today);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSelected(cell.date);
                          if (!cell.inMonth) setAnchor(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                        }}
                        className={cn(
                          "min-h-[88px] p-1 text-left align-top sm:min-h-[100px] sm:p-2",
                          cell.inMonth ? g.cell : g.cellMuted,
                          isTod && g.cellToday,
                          isSel && g.cellSelected,
                        )}
                      >
                        <div className={cn("text-sm font-medium", !cell.inMonth && "opacity-50")}>{cell.label}</div>
                        <div className="mt-1 space-y-0.5">
                          {dayEvents.slice(0, 3).map((ev) => (
                            <div key={ev.id} className={cn("truncate rounded px-1 py-0.5 text-[10px] font-medium sm:text-[11px]", g.eventChip)}>
                              {ev.title}
                            </div>
                          ))}
                          {dayEvents.length > 3 ? (
                            <div className="text-[10px] text-current/60">+{dayEvents.length - 3}</div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {view === "week" ? (
              <div className="min-w-[640px]">
                <div className="grid" style={{ gridTemplateColumns: "48px repeat(7, minmax(0,1fr))" }}>
                  <div className="border-b border-current/15" />
                  {weekDays.map((d) => (
                    <div key={dateKey(d)} className={cn("border-b py-2 text-center text-xs", g.cellHead)}>
                      <div className="font-semibold capitalize">{WEEKDAYS[d.getDay()]}</div>
                      <div className={cn("text-lg", sameDay(d, today) && cn("font-bold", isLight ? "text-[#1a73e8]" : "text-[#8ab4f8]"))}>{d.getDate()}</div>
                    </div>
                  ))}
                  {hours.map((h) => (
                    <Fragment key={h}>
                      <div className={cn("border-t py-2 pr-1 text-right", g.timeCol)}>{h}:00</div>
                      {weekDays.map((d) => {
                        const blocks = eventBlocksForDay(events, d).filter((ev) => {
                          const t = parseEventDay(ev.startISO);
                          return t && t.getHours() === h;
                        });
                        return (
                          <div key={`${dateKey(d)}-${h}`} className={cn("relative min-h-[48px] border border-t py-0.5 pl-0.5", g.weekCol)}>
                            {blocks.map((ev) => (
                              <div key={ev.id} className={cn("truncate rounded px-1 py-0.5 text-[10px] font-medium", g.eventChip)}>
                                {ev.title}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : null}

            {view === "day" ? (
              <div className="mx-auto max-w-lg">
                <div className="mb-3 text-center text-sm font-medium capitalize">
                  {selected ? `${WEEKDAYS[selected.getDay()]}, ${selected.getDate()} de ${MONTHS_PT[selected.getMonth()]} de ${selected.getFullYear()}` : ""}
                </div>
                <div className="space-y-0">
                  {hours.map((h) => {
                    const d = selected ?? today;
                    const blocks = eventBlocksForDay(events, d).filter((ev) => {
                      const t = parseEventDay(ev.startISO);
                      return t && t.getHours() === h;
                    });
                    return (
                      <div key={h} className="flex border-t border-current/15">
                        <div className={cn("w-14 shrink-0 py-2 pr-2 text-right", g.timeCol)}>{h}:00</div>
                        <div className={cn("min-h-[52px] flex-1 border-l border-current/15 py-1 pl-2", g.weekCol)}>
                          {blocks.map((ev) => (
                            <div key={ev.id} className={cn("mb-1 rounded px-2 py-1 text-xs font-medium", g.eventChip)}>
                              {ev.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {google.connected ? (
          <div className="border-t border-current/10 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-current/70">
              <span className="font-medium text-current">Calendario Google (incorporado)</span>
              {google.lastSyncISO ? (
                <span>Ultima sincronizacao simulada: {new Date(google.lastSyncISO).toLocaleString("pt-BR")}</span>
              ) : null}
            </div>
            <div className={cn("overflow-hidden rounded-xl border border-current/15", isLight ? "bg-black/5" : "bg-black/30")}>
              <iframe
                title="Google Agenda incorporado"
                src={GOOGLE_EMBED_HOLIDAYS}
                className="h-[420px] w-full border-0"
                loading="lazy"
              />
            </div>
            <p className="mt-2 text-[11px] text-current/55">
              Incorporacao publica de feriados (exemplo). Com OAuth, aqui entra o embed da sua agenda ou leitura via API com layout identico ao
              MyChatCRM.
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <div className={cn("rounded-xl border p-5 sm:rounded-xl", isLight ? "border-slate-200 bg-surface-deep" : "border-line bg-surface-deep/40")}>
          <h3 className="text-lg font-semibold text-content">Novo evento</h3>
          <p className="mt-1 text-xs text-content-secondary">Igual ao fluxo rapido do Google: titulo, horario e tipo.</p>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-content-secondary" htmlFor="agenda-novo-titulo">
                Titulo
              </label>
              <Input id="agenda-novo-titulo" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titulo do evento" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary" htmlFor="agenda-inicio">
                Inicio
              </label>
              <Input id="agenda-inicio" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary" htmlFor="agenda-tipo">
                Tipo
              </label>
              <Select id="agenda-tipo" className="mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="reuniao">Reuniao</option>
                <option value="demo">Demo</option>
                <option value="follow-up">Follow-up</option>
                <option value="outro">Outro</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-content-secondary" htmlFor="agenda-meet">
                Link Meet / Zoom
              </label>
              <Input id="agenda-meet" value={meet} onChange={(e) => setMeet(e.target.value)} placeholder="https://..." className="mt-1" />
            </div>
            <Toggle id="agenda-wa" checked={notifyWa} onChange={setNotifyWa} label="Notificar via WhatsApp" />
            <Button type="button" variant="gradient" className="w-full" onClick={onSaveEvent}>
              Salvar evento
            </Button>
          </div>
        </div>

        <div className={cn("rounded-xl border p-5 sm:rounded-xl", isLight ? "border-slate-200 bg-surface-deep" : "border-line bg-surface-deep/40")}>
          <h3 className="text-lg font-semibold text-content">Proximos eventos</h3>
          <ul className="mt-3 space-y-2 text-sm text-content-secondary">
            {[...events]
              .sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime())
              .slice(0, 12)
              .map((ev) => {
                const t = parseEventDay(ev.startISO);
                const when = t
                  ? t.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                  : ev.startISO;
                return (
                  <li key={ev.id} className="rounded-xl border border-line/80 bg-surface-card/40 px-3 py-2">
                    <span className="font-medium text-content">{ev.title}</span>
                    <span className="mt-0.5 block text-xs capitalize text-content-secondary">{when}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      </div>
    </div>
  );
}
