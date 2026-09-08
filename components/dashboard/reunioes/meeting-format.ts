import type { MeetingStatus } from "@/lib/meetings/types";

/** mm:ss, ou hh:mm:ss quando passa de uma hora. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Duração em linguagem natural, para os cards da biblioteca. */
export function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay) return `Hoje ${time}`;

  return `${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date)} ${time}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Horas restantes da cota, para o aviso no topo da biblioteca. */
export function formatQuotaHours(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 10) return `${Math.floor(hours)} h`;
  if (hours >= 1) return `${hours.toFixed(1).replace(".", ",")} h`;
  return `${Math.max(0, Math.round(seconds / 60))} min`;
}

type StatusTone = "default" | "primary" | "success" | "warning" | "danger" | "info";

/**
 * Estado do processamento em linguagem de quem gravou.
 *
 * `partial` merece destaque próprio: a reunião NÃO falhou — o áudio e a
 * transcrição estão lá, só a análise não saiu. Tratar como erro faria o usuário
 * descartar uma reunião que continua útil.
 */
export const MEETING_STATUS_PRESENTATION: Record<
  MeetingStatus,
  { label: string; tone: StatusTone; hint?: string }
> = {
  draft: { label: "Rascunho", tone: "default" },
  uploading: { label: "Enviando", tone: "info" },
  queued: { label: "Na fila", tone: "info", hint: "Começa em instantes." },
  transcribing: {
    label: "Transcrevendo",
    tone: "info",
    hint: "Normalmente leva cerca de 15% da duração da reunião.",
  },
  analyzing: { label: "Analisando", tone: "info", hint: "Quase lá — gerando resumo e tarefas." },
  completed: { label: "Concluída", tone: "success" },
  partial: {
    label: "Concluída em parte",
    tone: "warning",
    hint: "A transcrição está pronta; o resumo não pôde ser gerado. Você pode tentar de novo.",
  },
  failed: { label: "Falhou", tone: "danger" },
};

/** Estados em que ainda há trabalho acontecendo — a tela fica ouvindo o realtime. */
export function isProcessing(status: MeetingStatus): boolean {
  return status === "uploading" || status === "queued" || status === "transcribing" || status === "analyzing";
}

/** Cor estável por falante, derivada do rótulo (mesma pessoa, mesma cor sempre). */
const SPEAKER_COLORS = [
  "#F24400",
  "#0E7490",
  "#7C3AED",
  "#00A650",
  "#B45309",
  "#BE185D",
  "#1D4ED8",
  "#4D7C0F",
];

export function speakerColor(label: string | null): string {
  if (!label) return "#71717a";
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length] as string;
}

export function speakerDisplayName(
  label: string | null,
  speakers: Array<{ label: string; displayName: string | null }>,
): string {
  if (!label) return "Fala";
  const found = speakers.find((speaker) => speaker.label === label);
  return found?.displayName?.trim() || `Falante ${label}`;
}
