"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, Plus, Search } from "lucide-react";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { PanelInput } from "@/components/panel/ui/PanelInput";
import { Badge } from "@/components/ui/Badge";
import { MeetingCard, type MeetingListItem } from "./MeetingCard";
import { NewMeetingModal, type NewMeetingResult } from "./NewMeetingModal";
import { MeetingPage } from "./detail/MeetingPage";
import { RecordingScreen } from "./recorder/RecordingScreen";
import { uploadFileInParts } from "./upload/uploadFileInParts";
import { formatClock, formatQuotaHours, isProcessing } from "./meeting-format";

type QuotaState = {
  includedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  shouldWarn: boolean;
  exhausted: boolean;
};

type ContentHit = {
  meetingId: string;
  meetingTitle: string;
  content: string;
  startMs: number;
};

type View =
  | { kind: "library" }
  | { kind: "recording"; meetingId: string; mimeType: string }
  | { kind: "uploading"; meetingId: string; fileName: string; percent: number }
  | { kind: "detail"; meetingId: string };

/** Orquestrador do módulo: biblioteca, gravação, envio e detalhe. */
export function ReunioesHub() {
  const [view, setView] = useState<View>({ kind: "library" });
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentHits, setContentHits] = useState<ContentHit[]>([]);
  const [searchingContent, setSearchingContent] = useState(false);

  const loadLibrary = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("busca", search.trim());
      const response = await fetch(`/api/client/reunioes?${params.toString()}`);
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Não foi possível carregar.");
        return;
      }
      setMeetings((body.meetings as MeetingListItem[]) ?? []);
      setQuota((body.quota as QuotaState) ?? null);
      setError(null);
    } catch {
      setError("Não foi possível carregar as reuniões.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (view.kind !== "library") return;
    void loadLibrary();
  }, [loadLibrary, view.kind]);

  // Enquanto houver reunião em processamento, atualiza sozinho — o usuário não
  // deveria precisar recarregar para ver o resumo chegar.
  useEffect(() => {
    if (view.kind !== "library") return;
    if (!meetings.some((meeting) => isProcessing(meeting.status))) return;
    const timer = setInterval(() => void loadLibrary(), 10_000);
    return () => clearInterval(timer);
  }, [loadLibrary, meetings, view.kind]);

  // Busca no CONTEÚDO, separada da busca por título. Só dispara com 4+
  // caracteres e depois de meio segundo parado: cada consulta gera um embedding,
  // e disparar por tecla digitada seria pagar por cada letra.
  useEffect(() => {
    const term = search.trim();
    if (view.kind !== "library" || term.length < 4) {
      setContentHits([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchingContent(true);
      void fetch("/api/client/reunioes/busca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: term }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => setContentHits((body?.hits as ContentHit[]) ?? []))
        .catch(() => setContentHits([]))
        .finally(() => setSearchingContent(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [search, view.kind]);

  const handleReady = useCallback(async (result: NewMeetingResult) => {
    setModalOpen(false);

    if (result.kind === "record") {
      setView({ kind: "recording", meetingId: result.meetingId, mimeType: result.mimeType });
      return;
    }

    setView({
      kind: "uploading",
      meetingId: result.meetingId,
      fileName: result.file.name,
      percent: 0,
    });
    try {
      await uploadFileInParts({
        meetingId: result.meetingId,
        file: result.file,
        onProgress: (progress) =>
          setView({
            kind: "uploading",
            meetingId: result.meetingId,
            fileName: result.file.name,
            percent: Math.round((progress.sentBytes / progress.totalBytes) * 100),
          }),
      });
      setView({ kind: "detail", meetingId: result.meetingId });
    } catch {
      setError("O envio falhou. Tente novamente — o que já subiu foi aproveitado.");
      setView({ kind: "library" });
    }
  }, []);

  if (view.kind === "recording") {
    return (
      <RecordingScreen
        meetingId={view.meetingId}
        mimeType={view.mimeType}
        onFinished={(meetingId) => setView({ kind: "detail", meetingId })}
        onCancelled={() => setView({ kind: "library" })}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
        <MeetingPage meetingId={view.meetingId} onBack={() => setView({ kind: "library" })} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-content">Reuniões</h1>
          <p className="text-xs text-content-muted">
            Grave ou envie o áudio e receba transcrição, resumo e tarefas.
          </p>
        </div>
        <PanelButton size="sm" onClick={() => setModalOpen(true)} disabled={quota?.exhausted}>
          <Plus className="h-4 w-4" aria-hidden />
          Nova reunião
        </PanelButton>
      </div>

      {quota?.exhausted ? (
        <div className="mb-4 rounded-panel-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
          <p className="text-sm text-content">
            Você usou todas as horas de reunião deste mês.
          </p>
          <p className="mt-1 text-xs text-content-muted">
            A cota renova no início do próximo ciclo. Fale com o responsável pela conta para
            contratar horas extras.
          </p>
        </div>
      ) : quota?.shouldWarn ? (
        <div className="mb-4 rounded-panel-xl border border-line/45 bg-surface-elevated/30 px-3 py-2">
          <p className="text-xs text-content-secondary">
            Restam {formatQuotaHours(quota.remainingSeconds)} de gravação neste mês.
          </p>
        </div>
      ) : null}

      {view.kind === "uploading" ? (
        <div className="mb-4 rounded-panel-2xl border border-info/30 bg-info/[0.06] px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-content">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Enviando {view.fileName} — {view.percent}%
          </p>
          <p className="mt-1 text-xs text-content-muted">
            Mantenha esta aba aberta até o envio terminar.
          </p>
        </div>
      ) : null}

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
          aria-hidden
        />
        <PanelInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por título ou pelo que foi dito…"
          aria-label="Buscar reuniões"
          className="pl-9"
        />
      </div>

      {error ? (
        <p className="mb-3 rounded-panel-xl border border-error/30 bg-error/[0.06] px-3 py-2 text-xs text-content">
          {error}
        </p>
      ) : null}

      {contentHits.length > 0 || searchingContent ? (
        <section className="mb-4">
          <h2 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
            Trechos encontrados
            {searchingContent ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          </h2>
          <ul className="space-y-1.5">
            {contentHits.map((hit) => (
              <li key={`${hit.meetingId}-${hit.startMs}`}>
                <button
                  type="button"
                  onClick={() => setView({ kind: "detail", meetingId: hit.meetingId })}
                  className="w-full rounded-panel-xl border border-line/45 bg-surface-card/60 p-3 text-left hover:border-line/70 hover:bg-surface-elevated/40"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-content">{hit.meetingTitle}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-primary">
                      {formatClock(hit.startMs)}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-content-secondary">
                    {hit.content}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-content-muted" aria-hidden />
        </div>
      ) : meetings.length === 0 ? (
        <div className="rounded-panel-2xl border border-dashed border-line/60 px-6 py-12 text-center">
          <Mic className="mx-auto mb-3 h-8 w-8 text-content-faint" aria-hidden />
          <p className="text-sm font-medium text-content">Nenhuma reunião ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-content-muted">
            Grave pelo navegador ou envie um áudio que você já tem. Em poucos minutos ele vira
            transcrição, resumo e lista de tarefas.
          </p>
          <PanelButton size="sm" className="mt-4" onClick={() => setModalOpen(true)}>
            Começar
          </PanelButton>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.some((meeting) => isProcessing(meeting.status)) ? (
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="info">Em processamento</Badge>
            </div>
          ) : null}
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onOpen={(id) => setView({ kind: "detail", meetingId: id })}
            />
          ))}
        </div>
      )}

      <NewMeetingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onReady={handleReady}
      />
    </div>
  );
}
