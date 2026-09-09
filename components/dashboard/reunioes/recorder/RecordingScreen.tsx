"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Loader2, Mic, Pause, Play, Square, X } from "lucide-react";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { PanelInput } from "@/components/panel/ui/PanelInput";
import { cn } from "@/lib/utils";
import { formatClock } from "../meeting-format";
import { LiveWaveform } from "./LiveWaveform";
import { RECORDER_ERROR_MESSAGE, useMediaRecorder } from "./useMediaRecorder";
import { useChunkedUpload } from "./useChunkedUpload";
import { useWakeLock } from "./useWakeLock";

type Marker = { atMs: number; note: string };

/**
 * Tela cheia de gravação.
 *
 * Três ações e um botão principal — nada mais. O contador "salvo até" é o que
 * separa um usuário que confia no produto de um que grava no celular "por
 * garantia": ele mostra, em segundos, o que já está no servidor.
 */
export function RecordingScreen({
  meetingId,
  mimeType,
  onFinished,
  onCancelled,
}: {
  meetingId: string;
  mimeType: string;
  onFinished: (meetingId: string) => void;
  onCancelled: () => void;
}) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const elapsedRef = useRef(0);

  // Um `fetch` barrado por CORS falha com o MESMO erro de quando a rede cai.
  // Sem consultar o navegador, culpar a conexão é chute — e chute errado manda
  // o usuário reiniciar o Wi-Fi enquanto o problema está na configuração do
  // bucket.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const upload = useChunkedUpload({ meetingId, mimeType });

  const handleChunk = useCallback(
    (blob: Blob) => {
      void upload.addChunk(blob, elapsedRef.current);
    },
    [upload],
  );

  const recorder = useMediaRecorder({ onChunk: handleChunk });
  elapsedRef.current = recorder.elapsedMs;

  const isRecording = recorder.state === "recording";
  const wakeLock = useWakeLock(isRecording || recorder.state === "paused");

  // Começa assim que a tela abre: pedir mais um clique depois de o usuário já
  // ter clicado em "Gravar" é atrito puro.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void recorder.start();
  }, [recorder]);

  // Fechar a aba no meio da reunião não pode ser silencioso.
  useEffect(() => {
    if (!isRecording && recorder.state !== "paused") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRecording, recorder.state]);

  const addMarker = useCallback(() => {
    setMarkers((current) => [...current, { atMs: elapsedRef.current, note: "" }]);
  }, []);

  // Atalho de teclado: no desktop, marcar um momento sem tirar os olhos da
  // conversa é o que faz o recurso ser usado.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === "m" && isRecording) {
        event.preventDefault();
        addMarker();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addMarker, isRecording]);

  const saveNote = useCallback(() => {
    const note = noteDraft.trim();
    if (note) setMarkers((current) => [...current, { atMs: elapsedRef.current, note }]);
    setNoteDraft("");
    setNoteOpen(false);
  }, [noteDraft]);

  const finish = useCallback(async () => {
    setFinishing(true);
    setFinishFailed(false);
    await recorder.stop();
    const durationMs = elapsedRef.current;

    // As anotações entram no contexto da análise. Quem estava na sala sabe o
    // que importa melhor que o modelo.
    if (markers.length > 0) {
      const notes = markers
        .map((marker) => `[${formatClock(marker.atMs)}] ${marker.note || "Momento marcado"}`)
        .join("\n");
      await fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userNotes: notes }),
      }).catch(() => undefined);
    }

    const ok = await upload.finish(durationMs);
    setFinishing(false);
    // Voltar para a tela de gravação sem dizer nada deixaria o usuário achando
    // que o clique não pegou — e clicando de novo até desistir.
    setFinishFailed(!ok);
    if (ok) onFinished(meetingId);
  }, [markers, meetingId, onFinished, recorder, upload]);

  const cancel = useCallback(async () => {
    await recorder.stop();
    await upload.abort();
    onCancelled();
  }, [onCancelled, recorder, upload]);

  const fatal = recorder.state === "error" && recorder.error;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-surface-base">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <span className="text-xs font-medium text-content-muted">Gravando reunião</span>
        <PanelButton variant="ghost" size="xs" onClick={cancel} disabled={finishing}>
          <X className="h-4 w-4" aria-hidden />
          Cancelar
        </PanelButton>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-8">
        {fatal ? (
          <div className="w-full max-w-md rounded-panel-2xl border border-error/30 bg-error/[0.06] p-5 text-center">
            <p className="text-sm text-content">{RECORDER_ERROR_MESSAGE[recorder.error!]}</p>
            {upload.partsUploaded > 0 ? (
              <p className="mt-2 text-xs text-content-muted">
                {formatClock(upload.savedUpToMs)} de áudio já estão salvos. Você pode finalizar e
                processar o que foi gravado.
              </p>
            ) : null}
            <div className="mt-4 flex justify-center gap-2">
              <PanelButton variant="outline" size="sm" onClick={cancel}>
                Descartar
              </PanelButton>
              {upload.partsUploaded > 0 ? (
                <PanelButton size="sm" onClick={finish} disabled={finishing}>
                  Finalizar mesmo assim
                </PanelButton>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <p
              className="font-mono text-5xl font-semibold tabular-nums text-content sm:text-6xl"
              aria-live="off"
            >
              {formatClock(recorder.elapsedMs)}
            </p>

            <div className="w-full max-w-lg">
              <LiveWaveform level={recorder.level} active={isRecording} />
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className="flex items-center gap-2 text-sm font-medium text-content-secondary">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isRecording ? "animate-pulse bg-error" : "bg-content-faint",
                  )}
                  aria-hidden
                />
                {recorder.state === "requesting"
                  ? "Pedindo acesso ao microfone…"
                  : isRecording
                    ? "Gravando"
                    : "Pausado"}
              </span>
              <span className="text-xs text-content-muted">
                {upload.partsUploaded > 0
                  ? `Salvo até ${formatClock(upload.savedUpToMs)}`
                  : "Salvando no aparelho…"}
              </span>
              {upload.phase === "error" ? (
                <span className="text-xs text-warning">
                  {offline
                    ? "Sem conexão para enviar agora — a gravação continua e sobe quando a rede voltar."
                    : "O envio está falhando, mas a gravação continua salva neste aparelho."}
                  {upload.error && !offline ? (
                    <span className="ml-1 text-content-faint">({upload.error})</span>
                  ) : null}
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <PanelButton
                variant="outline"
                size="sm"
                onClick={isRecording ? recorder.pause : recorder.resume}
                disabled={recorder.state === "requesting" || finishing}
              >
                {isRecording ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                {isRecording ? "Pausar" : "Retomar"}
              </PanelButton>
              <PanelButton variant="outline" size="sm" onClick={addMarker} disabled={!isRecording}>
                <Bookmark className="h-4 w-4" aria-hidden />
                Marcar momento
              </PanelButton>
              <PanelButton
                variant="outline"
                size="sm"
                onClick={() => setNoteOpen((open) => !open)}
                disabled={!isRecording}
              >
                <Mic className="h-4 w-4" aria-hidden />
                Anotar
              </PanelButton>
            </div>

            {noteOpen ? (
              <div className="flex w-full max-w-md items-center gap-2">
                <PanelInput
                  autoFocus
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveNote();
                  }}
                  placeholder="O que é importante deste momento?"
                  aria-label="Anotação da reunião"
                />
                <PanelButton size="sm" onClick={saveNote}>
                  Salvar
                </PanelButton>
              </div>
            ) : null}

            {markers.length > 0 ? (
              <p className="text-xs text-content-muted">
                {markers.length} {markers.length === 1 ? "marcação" : "marcações"} nesta reunião
              </p>
            ) : null}

            <PanelButton size="lg" onClick={finish} disabled={finishing || recorder.state === "requesting"}>
              {finishing ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Square className="h-5 w-5" aria-hidden />
              )}
              {finishing ? "Finalizando…" : "Finalizar"}
            </PanelButton>

            {finishFailed ? (
              <div className="w-full max-w-md rounded-panel-2xl border border-error/30 bg-error/[0.06] p-4 text-center">
                <p className="text-sm text-content">
                  Não foi possível enviar o áudio para o servidor.
                </p>
                <p className="mt-1 text-xs text-content-muted">
                  A gravação continua guardada neste navegador. Não feche esta aba: assim que o
                  envio voltar a funcionar, clique em Finalizar de novo.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/*
        Aviso honesto e permanente. No iPhone não existe API de gravação em
        segundo plano: sair do app interrompe de verdade, e descobrir isso
        depois de 40 minutos custa a confiança do usuário.
      */}
      <div className="border-t border-line/40 bg-surface-elevated/40 px-4 py-3 text-center">
        <p className="text-xs text-content-muted">
          Mantenha esta tela aberta. Sair do app ou bloquear a tela interrompe a gravação.
          {wakeLock.held ? " A tela está sendo mantida acesa." : ""}
        </p>
      </div>
    </div>
  );
}
