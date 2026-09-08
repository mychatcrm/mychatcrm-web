"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  MEETING_STATUS_PRESENTATION,
  formatDateTime,
  formatDuration,
} from "@/components/dashboard/reunioes/meeting-format";
import type { MeetingStatus } from "@/lib/meetings/types";

type LeadMeeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  durationMs: number | null;
  recordedAt: string | null;
  createdAt: string;
  summaryLine?: string;
  actionItemCount?: number;
};

/**
 * Reuniões vinculadas ao lead, dentro da ficha.
 *
 * Reusa a rota de listagem com o filtro `leadId`: o recorte por escopo já é
 * aplicado lá, então esta tela não precisa (nem pode) decidir permissão.
 */
export function CrmLeadMeetingsPanel({ leadId }: { leadId: string }) {
  const [meetings, setMeetings] = useState<LeadMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/client/reunioes?leadId=${encodeURIComponent(leadId)}&limit=20`)
      .then(async (response) => {
        if (!active) return;
        // 404 = módulo desligado para esta conta. Não é erro para o usuário.
        if (response.status === 404) {
          setUnavailable(true);
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as { meetings?: LeadMeeting[] };
        setMeetings(body.meetings ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  if (unavailable) return null;

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-content-muted" aria-hidden />
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <p className="rounded-panel-xl border border-dashed border-line/50 px-4 py-6 text-center text-xs text-content-muted">
        Nenhuma reunião gravada com este lead.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {meetings.map((meeting) => {
        const presentation = MEETING_STATUS_PRESENTATION[meeting.status];
        return (
          <li key={meeting.id}>
            <a
              href={`/dashboard/reunioes?reuniao=${encodeURIComponent(meeting.id)}`}
              className="block rounded-panel-xl border border-line/45 bg-surface-card/60 p-3 transition-colors hover:border-line/70 hover:bg-surface-elevated/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-content">
                  <Mic className="h-3.5 w-3.5 text-primary" aria-hidden />
                  {meeting.title?.trim() || "Reunião sem título"}
                </span>
                <Badge variant={presentation.tone}>{presentation.label}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-content-muted">
                {formatDateTime(meeting.recordedAt ?? meeting.createdAt)} ·{" "}
                {formatDuration(meeting.durationMs)}
                {meeting.actionItemCount ? ` · ${meeting.actionItemCount} tarefas` : ""}
              </p>
              {meeting.summaryLine ? (
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-content-secondary">
                  {meeting.summaryLine}
                </p>
              ) : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
