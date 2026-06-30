"use client";

/**
 * Componentes de mídia read-only para o chat de monitoramento do admin.
 * Auto-contidos (sem dependência do hub de clientes) para não arriscar o /conversas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play } from "lucide-react";

function formatAudioTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function makeWaveBars(seed: string, count = 32): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return Array.from({ length: count }, (_, i) => {
    const v = ((h * (i + 1) * 1664525 + 1013904223) | 0) & 0x7fffffff;
    return 18 + (v % 82);
  });
}

export function AudioBubble({ src, msgId }: { src: string; msgId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => makeWaveBars(msgId), [msgId]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  }, [playing]);

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setElapsed(a.currentTime);
    setProgress(a.duration > 0 ? (a.currentTime / a.duration) * 100 : 0);
  }, []);

  const onLoaded = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  }, []);

  const onEnded = useCallback(() => {
    setPlaying(false);
    setProgress(0);
    setElapsed(0);
  }, []);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
  }, []);

  return (
    <div className="flex min-w-[210px] max-w-[270px] items-center gap-2.5">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoaded}
        onEnded={onEnded}
        preload="metadata"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar" : "Reproduzir"}
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex h-7 cursor-pointer items-center gap-[1.5px]" onClick={seek}>
          {bars.map((ht, i) => {
            const pct = (i / bars.length) * 100;
            return (
              <div
                key={i}
                className="w-[2px] flex-shrink-0 rounded-full transition-colors"
                style={{
                  height: `${Math.max(4, (ht / 100) * 24)}px`,
                  background: pct <= progress ? "var(--primary, #F24400)" : "rgba(134,150,160,0.5)",
                }}
              />
            );
          })}
        </div>
        <span className="text-[11px] leading-none text-content-muted">
          {playing ? formatAudioTime(elapsed) : formatAudioTime(duration || elapsed)}
        </span>
      </div>
      <a
        href={src}
        download={`audio-${msgId}.ogg`}
        target="_blank"
        rel="noreferrer"
        title="Baixar áudio"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-shrink-0 items-center text-primary opacity-80"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

export function ImageBubble({ src, caption }: { src: string; caption?: string }) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen]);

  return (
    <>
      <div className="cursor-zoom-in overflow-hidden rounded-md" onClick={() => setFullscreen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption || "Imagem"}
          className="block max-h-[260px] w-full max-w-full object-cover"
          loading="lazy"
        />
        {caption ? <p className="mx-1 mb-0.5 mt-1 text-[13px] text-content">{caption}</p> : null}
      </div>
      {fullscreen ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
          onClick={() => setFullscreen(false)}
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="Fechar"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border-none bg-white/10 text-xl text-white"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={caption || "Imagem"}
            className="max-h-[90vh] max-w-[90vw] rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}

export function VideoBubble({ src, caption }: { src: string; caption?: string }) {
  return (
    <div>
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        className="block max-h-[280px] w-full max-w-full rounded-md bg-black"
      />
      {caption ? <p className="mx-1 mb-0.5 mt-1 text-[13px] text-content">{caption}</p> : null}
    </div>
  );
}
