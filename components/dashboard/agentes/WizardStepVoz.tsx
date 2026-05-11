"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, Play, Square, Loader2, CheckCircle2 } from "lucide-react";
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
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
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

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    setPlayingId(null);
  }

  async function previewVoice(voice: Voice) {
    if (previewLoadingId) return;
    if (playingId === voice.voice_id) {
      stopAudio();
      return;
    }

    stopAudio();
    setPreviewLoadingId(voice.voice_id);
    setError("");

    try {
      const res = await fetch("/api/client/agentes/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voice.voice_id }),
      });

      if (!res.ok) {
        let message = `Erro ao gerar preview (${res.status}).`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          /* response may be audio or plain text */
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      previewObjectUrlRef.current = objectUrl;

      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onended = () => stopAudio();
      audio.onerror = () => stopAudio();
      await audio.play();
      setPlayingId(voice.voice_id);
    } catch (e) {
      stopAudio();
      setError(e instanceof Error ? e.message : "Erro ao gerar preview de voz.");
    } finally {
      setPreviewLoadingId(null);
    }
  }

  const isAudio = draft.responseMode === "audio";
  const selectedVoice = voices.find((voice) => voice.voice_id === draft.voiceId) ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface-elevated/20 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-elevated/40 text-content-muted">
            <Volume2 className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content">Modo de Resposta</p>
            <p className="mt-1 text-xs leading-relaxed text-content-muted">
              Escolha se o agente responde em texto normal ou em áudio com ElevenLabs.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChange({ ...draft, responseMode: "text", voiceId: "" })}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition",
              !isAudio
                ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                : "border-line bg-surface-elevated/30 hover:border-line/80 hover:bg-surface-elevated/50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-content">Texto</p>
                <p className="mt-1 text-xs leading-relaxed text-content-muted">
                  Envia mensagens padrão de WhatsApp sem gerar áudio.
                </p>
              </div>
              {!isAudio ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChange({ ...draft, responseMode: "audio" })}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition",
              isAudio
                ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                : "border-line bg-surface-elevated/30 hover:border-line/80 hover:bg-surface-elevated/50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-content">Áudio</p>
                <p className="mt-1 text-xs leading-relaxed text-content-muted">
                  Gera TTS com ElevenLabs e envia a resposta como áudio.
                </p>
              </div>
              {isAudio ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
            </div>
          </button>
        </div>
      </div>

      {isAudio && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface-elevated/20 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-content">Voz do agente</p>
              <p className="mt-1 text-xs leading-relaxed text-content-muted">
                As vozes são carregadas de `/api/client/agentes/voices`. Escolha uma voz para persistir `voice_id` junto com `response_mode=&quot;audio&quot;`.
              </p>
            </div>
            {selectedVoice ? (
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                {selectedVoice.name}
              </span>
            ) : null}
          </div>

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
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {voices.map((voice) => {
                const selected = draft.voiceId === voice.voice_id;
                const isPlaying = playingId === voice.voice_id;
                const isGeneratingPreview = previewLoadingId === voice.voice_id;
                return (
                  <div
                    key={voice.voice_id}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
                      selected
                        ? "border-primary/60 bg-primary/10 text-content"
                        : "border-line bg-surface-elevated/30 text-content-secondary hover:border-line/80 hover:bg-surface-elevated/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, voiceId: voice.voice_id })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-content">{voice.name}</p>
                          <p className="mt-1 truncate text-xs text-content-faint capitalize">{voice.category}</p>
                        </div>
                        {selected ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden rounded-full border border-line bg-surface-deep px-2 py-1 text-[11px] text-content-faint sm:inline-flex">
                        {voice.category}
                      </span>
                      <button
                        type="button"
                        onClick={() => previewVoice(voice)}
                        disabled={Boolean(previewLoadingId && previewLoadingId !== voice.voice_id)}
                        title={isGeneratingPreview ? "Gerando preview" : isPlaying ? "Parar preview" : "Ouvir voz"}
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50",
                          isPlaying || isGeneratingPreview
                            ? "border-primary/60 bg-primary/20 text-primary"
                            : "border-line bg-surface-deep text-content-muted hover:text-content",
                        )}
                      >
                        {isGeneratingPreview ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : isPlaying ? (
                          <Square className="h-3.5 w-3.5 fill-current" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedVoice ? (
            <p className="text-xs text-content-muted">
              Voz selecionada: <span className="font-medium text-content">{selectedVoice.name}</span>
            </p>
          ) : (
            <p className="text-xs text-amber-300">Selecione uma voz para salvar o modo de resposta em áudio.</p>
          )}
        </div>
      )}
    </div>
  );
}
