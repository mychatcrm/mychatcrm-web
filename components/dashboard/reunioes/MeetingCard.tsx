"use client";

import { CheckSquare, Clock, Link2, Target, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { MeetingStatus } from "@/lib/meetings/types";
import {
  MEETING_STATUS_PRESENTATION,
  formatDateTime,
  formatDuration,
  isProcessing,
} from "./meeting-format";

export type MeetingListItem = {
  id: string;
  title: string;
  meetingType: string;
  status: MeetingStatus;
  durationMs: number | null;
  recordedAt: string | null;
  createdAt: string;
  leadId: string | null;
  summaryLine?: string;
  speakerCount?: number;
  actionItemCount?: number;
  decisionCount?: number;
};

/**
 * Card da biblioteca.
 *
 * A primeira frase do resumo é o que dá valor imediato — é ela que faz alguém
 * reconhecer a reunião sem abrir. Por isso card e não tabela.
 */
export function MeetingCard({
  meeting,
  onOpen,
}: {
  meeting: MeetingListItem;
  onOpen: (id: string) => void;
}) {
  const presentation = MEETING_STATUS_PRESENTATION[meeting.status];
  const processing = isProcessing(meeting.status);

  return (
    <button
      type="button"
      onClick={() => onOpen(meeting.id)}
      className={cn(
        "w-full rounded-panel-2xl border border-line/45 bg-surface-card/70 p-4 text-left transition-colors",
        "hover:border-line/70 hover:bg-surface-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-content">
          {meeting.title?.trim() || "Reunião sem título"}
        </h3>
        <Badge variant={presentation.tone}>{presentation.label}</Badge>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content-muted">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          {formatDateTime(meeting.recordedAt ?? meeting.createdAt)}
        </span>
        <span>{formatDuration(meeting.durationMs)}</span>
        {meeting.speakerCount ? (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            {meeting.speakerCount} {meeting.speakerCount === 1 ? "participante" : "participantes"}
          </span>
        ) : null}
        {meeting.leadId ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <Link2 className="h-3 w-3" aria-hidden />
            Lead vinculado
          </span>
        ) : null}
      </div>

      {meeting.summaryLine ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-content-secondary">
          {meeting.summaryLine}
        </p>
      ) : processing ? (
        <p className="mt-2 text-xs text-content-muted">{presentation.hint ?? "Processando…"}</p>
      ) : null}

      {(meeting.actionItemCount ?? 0) > 0 || (meeting.decisionCount ?? 0) > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {meeting.actionItemCount ? (
            <Badge variant="primary">
              <CheckSquare className="h-3 w-3" aria-hidden />
              {meeting.actionItemCount} {meeting.actionItemCount === 1 ? "tarefa" : "tarefas"}
            </Badge>
          ) : null}
          {meeting.decisionCount ? (
            <Badge>
              <Target className="h-3 w-3" aria-hidden />
              {meeting.decisionCount} {meeting.decisionCount === 1 ? "decisão" : "decisões"}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
