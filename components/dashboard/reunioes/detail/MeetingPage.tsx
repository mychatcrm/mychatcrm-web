"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import { MEETING_TEMPLATE_LABEL, isMeetingTemplateKey } from "@/lib/ai/prompts/meeting-analysis";
import type { MeetingDetail, MeetingTranscriptSegment } from "@/lib/server/meeting-detail";
import {
  MEETING_STATUS_PRESENTATION,
  formatDateTime,
  formatDuration,
  isProcessing,
} from "../meeting-format";
import { AudioPlayer } from "./AudioPlayer";
import { TabAskAi } from "./TabAskAi";
import { TabOverview } from "./TabOverview";
import { TabTasks } from "./TabTasks";
import { TabTranscript } from "./TabTranscript";

type TabKey = "overview" | "transcript" | "tasks" | "decisions" | "ask";

export function MeetingPage({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [segments, setSegments] = useState<MeetingTranscriptSegment[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [currentMs, setCurrentMs] = useState(0);
  const [seekToMs, setSeekToMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}`);
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Reunião não encontrada.");
        return;
      }
      setDetail(body as unknown as MeetingDetail);
    } catch {
      setError("Não foi possível carregar a reunião.");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail || detail.meeting.status === "draft") return;
    void fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}/transcript`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.segments) setSegments(body.segments as MeetingTranscriptSegment[]);
      })
      .catch(() => undefined);
  }, [detail, meetingId]);

  // Enquanto processa, refaz a consulta periodicamente. Poll simples em vez de
  // realtime: são poucos minutos por reunião e evita uma assinatura viva por
  // aba aberta.
  useEffect(() => {
    if (!detail || !isProcessing(detail.meeting.status)) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [detail, load]);

  const seek = useCallback((ms: number) => {
    setSeekToMs(ms);
    setCurrentMs(ms);
  }, []);

  const updateTaskStatus = useCallback(
    async (taskId: string, status: "aberta" | "concluida" | "ignorada") => {
      setDetail((current) =>
        current
          ? {
              ...current,
              actionItems: current.actionItems.map((item) =>
                item.id === taskId ? { ...item, status } : item,
              ),
            }
          : current,
      );
      await fetch(
        `/api/client/reunioes/${encodeURIComponent(meetingId)}/tarefas/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      ).catch(() => void load());
    },
    [load, meetingId],
  );

  const applyTasksToAgenda = useCallback(
    async (taskIds: string[]) => {
      await fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}/tarefas/aplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds }),
      }).catch(() => undefined);
      // Recarrega para refletir o vínculo com o compromisso criado.
      await load();
    },
    [load, meetingId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-content-muted" aria-hidden />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-content-secondary">{error ?? "Reunião não encontrada."}</p>
        <PanelButton variant="outline" size="sm" onClick={onBack}>
          Voltar
        </PanelButton>
      </div>
    );
  }

  const { meeting } = detail;
  const presentation = MEETING_STATUS_PRESENTATION[meeting.status];
  const processing = isProcessing(meeting.status);

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: "overview", label: "Visão geral" },
    { key: "transcript", label: "Transcrição" },
    { key: "tasks", label: "Tarefas", count: detail.actionItems.length },
    { key: "decisions", label: "Decisões", count: detail.decisions.length },
    { key: "ask", label: "Pergunte à IA" },
  ];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-content-muted hover:text-content"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Reuniões
      </button>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-content">
            {meeting.title?.trim() || "Reunião sem título"}
          </h1>
          <Badge variant={presentation.tone}>{presentation.label}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted">
          <span>{formatDateTime(meeting.recordedAt ?? meeting.createdAt)}</span>
          <span>{formatDuration(meeting.durationMs)}</span>
          <span>
            {isMeetingTemplateKey(meeting.meetingType)
              ? MEETING_TEMPLATE_LABEL[meeting.meetingType]
              : meeting.meetingType}
          </span>
          {meeting.audioDeletedAt ? (
            <span className="text-warning">
              Áudio expirado — transcrição e análise preservadas
            </span>
          ) : null}
        </div>
      </header>

      {processing ? (
        <div className="rounded-panel-2xl border border-info/30 bg-info/[0.06] px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-content">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {presentation.label}…
          </p>
          {presentation.hint ? (
            <p className="mt-1 text-xs text-content-muted">{presentation.hint}</p>
          ) : null}
          <p className="mt-1 text-xs text-content-muted">
            Pode fechar esta tela: avisamos quando ficar pronta.
          </p>
        </div>
      ) : null}

      {meeting.status === "failed" ? (
        <div className="rounded-panel-2xl border border-error/30 bg-error/[0.06] px-4 py-3">
          <p className="text-sm text-content">
            Não foi possível processar esta reunião.
            {meeting.failedReason === "transcription_empty"
              ? " O áudio não tem fala audível."
              : meeting.failedReason === "transcription_provider_error"
                ? " O serviço de transcrição recusou o áudio."
                : ""}
          </p>
        </div>
      ) : null}

      {!meeting.audioDeletedAt && meeting.status !== "draft" ? (
        // Fica fixo: trocar de aba não pode interromper o que está tocando.
        <div className="sticky top-0 z-10 -mx-1 bg-surface-base/95 px-1 py-1 backdrop-blur">
          <AudioPlayer
            meetingId={meetingId}
            durationMs={meeting.durationMs}
            chapters={detail.chapters.map((chapter) => ({
              title: chapter.title,
              startMs: chapter.startMs,
            }))}
            currentMs={currentMs}
            onTimeUpdate={setCurrentMs}
            seekToMs={seekToMs}
          />
        </div>
      ) : null}

      <div className="flex gap-1 overflow-x-auto border-b border-line/40 pb-px">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              tab === entry.key
                ? "border-primary text-content"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {entry.label}
            {entry.count ? <span className="ml-1 text-content-faint">{entry.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? <TabOverview detail={detail} onSeek={seek} /> : null}
      {tab === "transcript" ? (
        <TabTranscript
          segments={segments}
          speakers={detail.speakers}
          currentMs={currentMs}
          onSeek={seek}
        />
      ) : null}
      {tab === "tasks" ? (
        <TabTasks
          items={detail.actionItems}
          onSeek={seek}
          onUpdateStatus={updateTaskStatus}
          onApplyToAgenda={applyTasksToAgenda}
        />
      ) : null}
      {tab === "ask" ? (
        <TabAskAi meetingId={meetingId} onSeek={seek} disabled={segments.length === 0} />
      ) : null}
      {tab === "decisions" ? (
        detail.decisions.length === 0 ? (
          <p className="rounded-panel-2xl border border-line/45 bg-surface-card/60 px-4 py-6 text-center text-sm text-content-muted">
            Nenhuma decisão foi identificada nesta reunião.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.decisions.map((decision) => (
              <li
                key={decision.id}
                className="rounded-panel-2xl border border-line/45 bg-surface-card/60 p-3.5"
              >
                <p className="text-sm leading-relaxed text-content">{decision.text}</p>
                <button
                  type="button"
                  onClick={() => seek(decision.atMs)}
                  className="mt-1.5 font-mono text-[11px] tabular-nums text-primary hover:underline"
                >
                  Ouvir este trecho
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
