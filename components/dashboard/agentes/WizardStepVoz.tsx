"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, Play, Square, Loader2 } from "lucide-react";
import type { AgentWizardDraft } from "@/lib/agents";
import { cn } from "@/lib/utils";

type Voice = {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string;
};

type Props = {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
};

export function WizardStepVoz({ draft, onChange }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedRef = useRef(false);

  // Carrega vozes ao montar (lazy — só quando responseMode === 'audio')
  useEffect(() => {
    if (draft.responseMode !== "audio" || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    fetch("/api/client/agentes/voices")
      .then((r) => r.json())
      .then((d: { voices?: Voice[]; error?: string }) => {
        if (d.error) throw new Error(d.error);
        setVoices(d.voices ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [draft.responseMode]);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setPlayingId(null);
  }

  function previewVoice(voice: Voice) {
    if (!voice.preview_url) return;
    if (playingId === voice.voice_id) {
      stopAudio();
      return;
    }
    stopAudio();
    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audio.play().catch(() => setPlayingId(null));
    setPlayingId(voice.voice_id);
  }

  const isAudio = draft.responseMode === "audio";

  return (
    <div className="space-y-4">
      {/* Toggle Texto / Áudio */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface-elevated/30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Volume2 className="h-4 w-4 shrink-0 text-content-muted" strokeWidth={1.75} />
          <div>
            <p className="text-sm font-medium text-content">Modo de resposta</p>
            <p className="text-xs text-content-muted">
              {isAudio ? "O agente responde com mensagens de áudio (ElevenLabs TTS)" : "O agente responde com mensagens de texto"}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isAudio}
          onClick={() =>
            onChange({
              ...draft,
              responseMode: isAudio ? "text" : "audio",
              voiceId: isAudio ? "" : draft.voiceId,
            })
          }
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
            isAudio ? "bg-primary" : "bg-surface-deep",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
              isAudio ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>

      {/* Seleção de voz — visível apenas quando áudio ativo */}
      {isAudio && (
        <div className="space-y-3 rounded-xl border border-line bg-surface-elevated/20 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-secondary">Escolha a voz</p>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-content-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando vozes…
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}

          {!loading && !error && voices.length === 0 && (
            <p className="text-sm text-content-muted">Nenhuma voz encontrada.</p>
          )}

          {!loading && voices.length > 0 && (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {voices.map((voice) => {
                const selected = draft.voiceId === voice.voice_id;
                const isPlaying = playingId === voice.voice_id;
                return (
                  <button
                    key={voice.voice_id}
                    type="button"
                    onClick={() => onChange({ ...draft, voiceId: voice.voice_id })}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-primary/60 bg-primary/10 text-content"
                        : "border-line bg-surface-elevated/30 text-content-secondary hover:border-line/80 hover:bg-surface-elevated/50",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{voice.name}</p>
                      <p className="truncate text-xs text-content-faint capitalize">{voice.category}</p>
                    </div>

                    {/* Botão de preview */}
                    {voice.preview_url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          previewVoice(voice);
                        }}
                        title={isPlaying ? "Parar preview" : "Ouvir voz"}
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition",
                          isPlaying
                            ? "border-primary/60 bg-primary/20 text-primary"
                            : "border-line bg-surface-deep text-content-muted hover:text-content",
                        )}
                      >
                        {isPlaying ? (
                          <Square className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current" />
                        )}
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {draft.voiceId && (
            <p className="text-xs text-content-muted">
              Voz selecionada:{" "}
              <span className="font-medium text-content">
                {voices.find((v) => v.voice_id === draft.voiceId)?.name ?? draft.voiceId}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
