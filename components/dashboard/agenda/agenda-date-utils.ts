import { MONTHS_PT } from "./agenda-constants";

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeekSunday(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function getMonthGrid(year: number, month: number) {
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

export function formatPeriodTitle(view: "day" | "week" | "month" | "agenda", anchor: Date, selected: Date) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (view === "month" || view === "agenda") {
    return `${MONTHS_PT[m]} de ${y}`;
  }
  if (view === "day") {
    const d = selected;
    return `${d.getDate()} de ${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`;
  }
  const ws = startOfWeekSunday(selected);
  const we = addDays(ws, 6);
  if (ws.getMonth() === we.getMonth()) {
    return `${ws.getDate()} – ${we.getDate()} de ${MONTHS_PT[ws.getMonth()]} de ${y}`;
  }
  return `${ws.getDate()} ${MONTHS_PT[ws.getMonth()].slice(0, 3)} – ${we.getDate()} ${MONTHS_PT[we.getMonth()].slice(0, 3)} de ${y}`;
}

export function toDatetimeLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function minutesSinceMidnight(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

export function eventDurationMinutes(startISO: string, endISO: string) {
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  return Math.max(15, Math.round(ms / 60000));
}
