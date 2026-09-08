"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClock } from "../meeting-format";

const SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;
const SKIP_SECONDS = 15;

export type PlayerChapter = { title: string; startMs: number };

/**
 * Player da reunião.
 *
 * Fica fixo no topo e NÃO desmonta ao trocar de aba — parar o áudio porque a
 * pessoa foi ver as tarefas seria o oposto do que ela quer.
 *
 * A URL do áudio é temporária (2 h) e buscada sob demanda; se expirar durante
 * uma reunião longa, o player pede outra em vez de simplesmente falhar.
 */
export function AudioPlayer({
  meetingId,
  durationMs,
  chapters,
  currentMs,
  onTimeUpdate,
  seekToMs,
}: {
  meetingId: string;
  durationMs: number | null;
  chapters: PlayerChapter[];
  currentMs: number;
  onTimeUpdate: (ms: number) => void;
  seekToMs: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0);

  const loadUrl = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}/audio-url`);
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Não foi possível carregar o áudio.");
        return;
      }
      if (audioRef.current && typeof body.url === "string") {
        audioRef.current.src = body.url;
        setReady(true);
      }
    } catch {
      setError("Não foi possível carregar o áudio.");
    }
  }, [meetingId]);

  useEffect(() => {
    void loadUrl();
  }, [loadUrl]);

  // Clique na transcrição ou num capítulo: leva o áudio para o ponto pedido.
  useEffect(() => {
    if (seekToMs === null || !audioRef.current || !ready) return;
    audioRef.current.currentTime = seekToMs / 1000;
    void audioRef.current.play().catch(() => undefined);
  }, [ready, seekToMs]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError("Não foi possível reproduzir o áudio."));
    else audio.pause();
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
  }, []);

  const changeSpeed = useCallback(() => {
    const index = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [speed]);

  // Atalhos só quando o foco não está num campo de texto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      }
      if (event.key === "ArrowLeft") skip(-5);
      if (event.key === "ArrowRight") skip(5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip, togglePlay]);

  const totalSeconds = duration || (durationMs ?? 0) / 1000;
  const progress = totalSeconds > 0 ? (currentMs / 1000 / totalSeconds) * 100 : 0;

  const seekFromBar = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !totalSeconds) return;
      const rect = event.currentTarget.getBoundingClientRect();
      audio.currentTime = ((event.clientX - rect.left) / rect.width) * totalSeconds;
    },
    [totalSeconds],
  );

  if (error) {
    return (
      <div className="rounded-panel-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
        <p className="text-xs text-content">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-panel-2xl border border-line/45 bg-surface-card/80 p-3">
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime * 1000)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setError("O áudio não pôde ser carregado. Ele pode ter expirado.")}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          aria-label={playing ? "Pausar" : "Reproduzir"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {!ready ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="h-4 w-4" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
        </button>

        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          disabled={!ready}
          aria-label={`Voltar ${SKIP_SECONDS} segundos`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-content-secondary hover:bg-surface-elevated/50 hover:text-content"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          disabled={!ready}
          aria-label={`Avançar ${SKIP_SECONDS} segundos`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-content-secondary hover:bg-surface-elevated/50 hover:text-content"
        >
          <RotateCw className="h-4 w-4" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          {/*
            A barra é um slider real para leitor de tela e teclado; o div com
            clique cobre o ponteiro. Sem o role, o player fica inoperável para
            quem não usa mouse.
          */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Posição da reprodução"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalSeconds)}
            aria-valuenow={Math.round(currentMs / 1000)}
            aria-valuetext={formatClock(currentMs)}
            onClick={seekFromBar}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") skip(-5);
              if (event.key === "ArrowRight") skip(5);
            }}
            className="relative h-8 cursor-pointer"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-elevated" />
            <div
              className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
            {chapters.map((chapter) => (
              <span
                key={`${chapter.startMs}-${chapter.title}`}
                title={chapter.title}
                className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-content-faint"
                style={{
                  left: `${totalSeconds > 0 ? Math.min(100, (chapter.startMs / 1000 / totalSeconds) * 100) : 0}%`,
                }}
              />
            ))}
          </div>
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-content-muted">
          {formatClock(currentMs)} / {formatClock(totalSeconds * 1000)}
        </span>

        <button
          type="button"
          onClick={changeSpeed}
          aria-label={`Velocidade ${speed}x. Clique para mudar.`}
          className={cn(
            "shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] text-content-secondary hover:bg-surface-elevated/50 hover:text-content",
            speed !== 1 && "bg-primary/10 text-primary",
          )}
        >
          {speed}×
        </button>
      </div>
    </div>
  );
}
