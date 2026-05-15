import type { ClientAgendaEvent } from "@/lib/agenda/client-event";
import { sameDay, startOfDay } from "./agenda-date-utils";

export type PositionedEvent = ClientAgendaEvent & {
  col: number;
  colCount: number;
  topPx: number;
  heightPx: number;
};

export function eventsForDay(events: ClientAgendaEvent[], day: Date) {
  return events.filter((e) => sameDay(new Date(e.startISO), day));
}

/** Eventos all-day para um dia (aparecem no topo da célula, não no grid horário). */
export function allDayEventsForDay(events: ClientAgendaEvent[], day: Date) {
  return events.filter((e) => e.allDay && sameDay(new Date(e.startISO), day));
}

/** Layout de eventos sobrepostos (estilo Google) para vista semana/dia.
 *  Eventos all-day são excluídos — aparecem na faixa acima do grid. */
export function layoutTimedEvents(
  events: ClientAgendaEvent[],
  day: Date,
  hourHeightPx: number,
): PositionedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const items = events
    .filter((e) => !e.allDay)
    .map((e) => {
      const s = new Date(e.startISO).getTime();
      const en = new Date(e.endISO).getTime();
      if (en <= dayStart || s >= dayEnd) return null;
      const clipStart = Math.max(s, dayStart);
      const clipEnd = Math.min(en, dayEnd);
      const topMin = (clipStart - dayStart) / 60000;
      const heightMin = Math.max(15, (clipEnd - clipStart) / 60000);
      return {
        ...e,
        _start: clipStart,
        _end: clipEnd,
        topPx: (topMin / 60) * hourHeightPx,
        heightPx: (heightMin / 60) * hourHeightPx,
        col: 0,
        colCount: 1,
      };
    })
    .filter((x): x is PositionedEvent & { _start: number; _end: number } => x !== null)
    .sort((a, b) => a._start - b._start || b._end - a._end);

  const clusters: (typeof items)[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;
  for (const ev of items) {
    if (!cluster.length || ev._start < clusterEnd) {
      cluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev._end);
    } else {
      clusters.push(cluster);
      cluster = [ev];
      clusterEnd = ev._end;
    }
  }
  if (cluster.length) clusters.push(cluster);

  const positioned: PositionedEvent[] = [];
  for (const group of clusters) {
    const columns: number[] = [];
    for (const ev of group) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        if (ev._start >= columns[c]!) {
          ev.col = c;
          columns[c] = ev._end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev.col = columns.length;
        columns.push(ev._end);
      }
    }
    const colCount = Math.max(1, columns.length);
    for (const ev of group) {
      const { _start: _s, _end: _e, ...rest } = ev;
      void _s;
      void _e;
      positioned.push({ ...rest, colCount });
    }
  }
  return positioned;
}
