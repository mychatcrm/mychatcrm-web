import { BRAND } from "@/lib/brand";

export const AGENDA_BRAND = BRAND.orange;
export const AGENDA_BRAND_HOVER = BRAND.orangeDark;
export const HOUR_HEIGHT_PX = 60;
export const GRID_HOURS = 24;
export const DEFAULT_EVENT_COLOR = AGENDA_BRAND;

/** 10 cores estilo Google Calendar */
export const AGENDA_EVENT_COLORS = [
  { id: "lavender", hex: "#7986cb" },
  { id: "sage", hex: "#33b679" },
  { id: "grape", hex: "#8e24aa" },
  { id: "flamingo", hex: "#e67c73" },
  { id: "banana", hex: "#f6bf26" },
  { id: "tangerine", hex: "#f24400" },
  { id: "peacock", hex: "#039be5" },
  { id: "graphite", hex: "#616161" },
  { id: "blueberry", hex: "#3f51b5" },
  { id: "basil", hex: "#0b8043" },
] as const;

export type AgendaViewMode = "day" | "week" | "month" | "agenda";

export const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export const WEEKDAYS_SHORT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."] as const;
export const WEEKDAYS_MINI = ["D", "S", "T", "Q", "Q", "S", "S"] as const;
