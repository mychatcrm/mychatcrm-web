"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MEETING_RECORDER_AUDIO_BITS_PER_SECOND,
  MEETING_RECORDER_AUDIO_CONSTRAINTS,
  pickSupportedRecorderMimeType,
} from "@/lib/meetings/audio-formats";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "stopped" | "error";

export type RecorderError =
  | "permission_denied"
  | "no_microphone"
  | "unsupported_browser"
  | "interrupted"
  | "unknown";

/** Mensagem em português para cada falha — a interface nunca mostra o erro cru. */
export const RECORDER_ERROR_MESSAGE: Record<RecorderError, string> = {
  permission_denied:
    "O navegador bloqueou o microfone. Autorize o acesso nas permissões do site e tente de novo.",
  no_microphone: "Nenhum microfone encontrado. Conecte um microfone e tente de novo.",
  unsupported_browser:
    "Este navegador não grava áudio. Use Chrome, Edge, Firefox ou Safari atualizado — ou envie um arquivo.",
  interrupted:
    "A gravação foi interrompida (uma ligação ou outro app assumiu o microfone). O que já foi gravado está salvo.",
  unknown: "Não foi possível gravar. O que já foi gravado está salvo.",
};

export type UseMediaRecorderOptions = {
  /** Um blob a cada N ms. 5 s equilibra perda máxima e número de escritas. */
  timesliceMs?: number;
  onChunk: (blob: Blob) => void;
  onInterrupted?: () => void;
};

export type UseMediaRecorderResult = {
  state: RecorderState;
  error: RecorderError | null;
  mimeType: string | null;
  elapsedMs: number;
  /** Nível de 0 a 1 para a forma de onda. */
  level: number;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
};

function classifyError(error: unknown): RecorderError {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "permission_denied";
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return "no_microphone";
  }
  return "unknown";
}

export function useMediaRecorder(options: UseMediaRecorderOptions): UseMediaRecorderResult {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const onChunkRef = useRef(options.onChunk);
  const onInterruptedRef = useRef(options.onInterrupted);

  // Refs para o callback mais recente: reassinar o MediaRecorder a cada render
  // perderia chunks entre a troca de handler.
  useEffect(() => {
    onChunkRef.current = options.onChunk;
    onInterruptedRef.current = options.onInterrupted;
  }, [options.onChunk, options.onInterrupted]);

  const teardown = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  // Cronômetro derivado do relógio, não de contagem de ticks: um `setInterval`
  // atrasado por aba em segundo plano faria o tempo exibido divergir do áudio.
  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(() => {
      setElapsedMs(accumulatedRef.current + (Date.now() - startedAtRef.current));
    }, 200);
    return () => clearInterval(timer);
  }, [state]);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        setLevel(peak);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Medidor é enfeite: sem ele a gravação continua normalmente.
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("requesting");

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("unsupported_browser");
      setState("error");
      return;
    }

    const selectedMime = pickSupportedRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!selectedMime) {
      setError("unsupported_browser");
      setState("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: MEETING_RECORDER_AUDIO_CONSTRAINTS,
      });
    } catch (err) {
      setError(classifyError(err));
      setState("error");
      return;
    }

    streamRef.current = stream;
    setMimeType(selectedMime);

    // O iOS tira o microfone quando entra uma ligação. Detectar aqui é o que
    // permite avisar em vez de gravar silêncio até o usuário perceber.
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        onInterruptedRef.current?.();
        setError("interrupted");
        setState("error");
      };
      track.onmute = () => {
        onInterruptedRef.current?.();
        setError("interrupted");
        setState("error");
      };
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: selectedMime,
      audioBitsPerSecond: MEETING_RECORDER_AUDIO_BITS_PER_SECOND,
    });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) onChunkRef.current(event.data);
    };

    accumulatedRef.current = 0;
    startedAtRef.current = Date.now();
    recorder.start(options.timesliceMs ?? 5_000);
    startLevelMeter(stream);
    setState("recording");
  }, [options.timesliceMs, startLevelMeter]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== "recording") return;
    recorderRef.current.pause();
    accumulatedRef.current += Date.now() - startedAtRef.current;
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== "paused") return;
    recorderRef.current.resume();
    startedAtRef.current = Date.now();
    setState("recording");
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setState("stopped");
      return;
    }

    // `stop()` ainda emite um último `ondataavailable`. Resolver antes disso
    // perderia o trecho final da reunião.
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    if (state === "recording") accumulatedRef.current += Date.now() - startedAtRef.current;
    setElapsedMs(accumulatedRef.current);
    teardown();
    setState("stopped");
  }, [state, teardown]);

  return { state, error, mimeType, elapsedMs, level, start, pause, resume, stop };
}
