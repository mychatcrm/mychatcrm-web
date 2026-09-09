"use client";

import { useCallback, useRef, useState } from "react";
import {
  clearSession,
  deleteChunksBefore,
  readChunksFrom,
  readSession,
  saveChunk,
  saveSession,
} from "./recording-store";

/**
 * Envio da gravação em partes.
 *
 * Duas camadas, de propósito:
 *  - cada trecho de 5 s vai para o IndexedDB no ato (perda máxima: 5 segundos);
 *  - a cada ~5 MB acumulados, uma parte sobe para o R2.
 *
 * O R2 monta o arquivo final no `complete`, byte a byte. Isso importa mais do
 * que parece: em WebM/Opus só o PRIMEIRO trecho do MediaRecorder carrega o
 * cabeçalho do container, então subir trechos como objetos separados produziria
 * arquivos que ninguém decodifica. Partes de um mesmo multipart são fatias do
 * mesmo stream, e o resultado é sempre válido.
 */

/** Mínimo do protocolo S3 para qualquer parte que não seja a última. */
const PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PART_RETRIES = 4;

export type UploadPhase = "idle" | "uploading" | "flushing" | "completing" | "done" | "error";

export type UseChunkedUploadResult = {
  phase: UploadPhase;
  /** Milissegundos de áudio já confirmados no R2 — alimenta o "salvo até". */
  savedUpToMs: number;
  bytesBuffered: number;
  partsUploaded: number;
  error: string | null;
  addChunk: (blob: Blob, elapsedMs: number) => Promise<void>;
  finish: (durationMs: number) => Promise<boolean>;
  abort: () => Promise<void>;
  resume: (meetingId: string) => Promise<boolean>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `http_${response.status}`);
  }
  return body as T;
}

export function useChunkedUpload(params: {
  meetingId: string;
  mimeType: string;
}): UseChunkedUploadResult {
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [savedUpToMs, setSavedUpToMs] = useState(0);
  const [bytesBuffered, setBytesBuffered] = useState(0);
  const [partsUploaded, setPartsUploaded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const bufferRef = useRef<Blob[]>([]);
  const bufferBytesRef = useRef(0);
  const seqRef = useRef(0);
  const firstPendingSeqRef = useRef(0);
  const nextPartRef = useRef(1);
  const partsRef = useRef<Array<{ partNumber: number; etag: string }>>([]);
  const uploadStartedRef = useRef(false);
  const lastElapsedRef = useRef(0);
  const flushingRef = useRef(false);
  /** Por que a última parte não subiu. Guardado porque o erro de `finish`
   *  chega depois e é só o sintoma: sem partes não dá para fechar. Trocar a
   *  causa pelo sintoma manda o usuário investigar a coisa errada. */
  const partFailureRef = useRef<string | null>(null);

  const base = `/api/client/reunioes/${encodeURIComponent(params.meetingId)}/uploads`;

  const ensureUploadStarted = useCallback(async () => {
    if (uploadStartedRef.current) return;
    await fetchJson<{ uploadId: string }>(`${base}/start`, { method: "POST" });
    uploadStartedRef.current = true;
  }, [base]);

  /** Envia UMA parte, com repetição — queda de rede é o caso comum, não a exceção. */
  const uploadPart = useCallback(
    async (partNumber: number, body: Blob): Promise<string> => {
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt += 1) {
        try {
          const { urls } = await fetchJson<{ urls: Array<{ partNumber: number; url: string }> }>(
            `${base}/part-urls`,
            { method: "POST", body: JSON.stringify({ partNumbers: [partNumber] }) },
          );
          const target = urls.find((entry) => entry.partNumber === partNumber);
          if (!target) throw new Error("part_url_missing");

          const response = await fetch(target.url, { method: "PUT", body });
          if (!response.ok) throw new Error(`part_upload_http_${response.status}`);

          // O ETag é lido quando o CORS do bucket o expõe, mas NÃO é exigido: o
          // servidor pergunta ao R2 quais partes chegaram antes de fechar. Isso
          // tira do caminho a única configuração de bucket que o upload
          // precisava, e nos poupa de confiar no que o navegador reporta.
          return response.headers.get("etag")?.replaceAll('"', "") ?? "";
        } catch (err) {
          lastError = err;
          // Espera crescente: insistir de imediato em rede instável só queima
          // bateria e piora o congestionamento.
          await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("part_upload_failed");
    },
    [base],
  );

  const flushPart = useCallback(
    async (force: boolean) => {
      if (flushingRef.current) return;
      if (bufferRef.current.length === 0) return;
      if (!force && bufferBytesRef.current < PART_SIZE_BYTES) return;

      flushingRef.current = true;
      setPhase("flushing");
      try {
        await ensureUploadStarted();

        const partNumber = nextPartRef.current;
        const body = new Blob(bufferRef.current, { type: params.mimeType });
        const consumedUpToSeq = seqRef.current;

        const etag = await uploadPart(partNumber, body);
        partFailureRef.current = null;
        partsRef.current.push({ partNumber, etag });
        nextPartRef.current = partNumber + 1;

        bufferRef.current = [];
        bufferBytesRef.current = 0;
        setBytesBuffered(0);
        setPartsUploaded(partsRef.current.length);
        setSavedUpToMs(lastElapsedRef.current);

        // Só libera o IndexedDB DEPOIS que a parte está confirmada no R2 —
        // apagar antes trocaria uma garantia por outra.
        await deleteChunksBefore(params.meetingId, consumedUpToSeq);
        firstPendingSeqRef.current = consumedUpToSeq;

        await saveSession({
          meetingId: params.meetingId,
          mimeType: params.mimeType,
          startedAt: Date.now(),
          uploadedParts: partsRef.current,
          nextPartNumber: nextPartRef.current,
          firstPendingSeq: firstPendingSeqRef.current,
          durationMs: lastElapsedRef.current,
        });

        setPhase("uploading");
      } catch (err) {
        // A gravação continua: o áudio está no IndexedDB e sobe depois. Falha
        // de upload nunca pode parar a captura.
        partFailureRef.current = err instanceof Error ? err.message : "upload_failed";
        setError(partFailureRef.current);
        setPhase("error");
      } finally {
        flushingRef.current = false;
      }
    },
    [ensureUploadStarted, params.meetingId, params.mimeType, uploadPart],
  );

  const addChunk = useCallback(
    async (blob: Blob, elapsedMs: number) => {
      lastElapsedRef.current = elapsedMs;
      const seq = seqRef.current;
      seqRef.current = seq + 1;

      // Persistir ANTES de bufferar: se o navegador morrer no próximo
      // milissegundo, este trecho já está salvo.
      await saveChunk(params.meetingId, seq, blob).catch(() => undefined);

      bufferRef.current.push(blob);
      bufferBytesRef.current += blob.size;
      setBytesBuffered(bufferBytesRef.current);
      if (phase === "idle") setPhase("uploading");

      void flushPart(false);
    },
    [flushPart, params.meetingId, phase],
  );

  const finish = useCallback(
    async (durationMs: number) => {
      setPhase("completing");
      try {
        lastElapsedRef.current = durationMs;
        // A última parte é isenta do mínimo de 5 MB.
        await flushPart(true);
        if (partsRef.current.length === 0) {
          throw new Error(partFailureRef.current ?? "meeting_parts_invalid");
        }

        await fetchJson(`${base}/complete`, {
          method: "POST",
          body: JSON.stringify({
            parts: partsRef.current,
            durationMs,
            recordedAt: new Date().toISOString(),
          }),
        });

        await clearSession(params.meetingId);
        setSavedUpToMs(durationMs);
        setPhase("done");
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "complete_failed");
        setPhase("error");
        return false;
      }
    },
    [base, flushPart, params.meetingId],
  );

  const abort = useCallback(async () => {
    try {
      await fetch(`${base}/status`, { method: "DELETE" });
    } catch {
      // Sem rede o servidor limpa depois, pela varredura de multipart órfão.
    }
    await clearSession(params.meetingId);
    bufferRef.current = [];
    bufferBytesRef.current = 0;
    partsRef.current = [];
    setPhase("idle");
  }, [base, params.meetingId]);

  /**
   * Retoma uma gravação interrompida.
   *
   * A verdade sobre o que já subiu está no R2, não no navegador: por isso o
   * estado vem do servidor, e o IndexedDB só fornece o que ainda falta enviar.
   */
  const resume = useCallback(
    async (meetingId: string) => {
      try {
        const status = await fetchJson<{
          uploadId: string | null;
          uploadedParts: Array<{ partNumber: number; etag: string }>;
          nextPartNumber: number;
        }>(`/api/client/reunioes/${encodeURIComponent(meetingId)}/uploads/status`);

        if (!status.uploadId) return false;

        uploadStartedRef.current = true;
        partsRef.current = status.uploadedParts;
        nextPartRef.current = status.nextPartNumber;
        setPartsUploaded(status.uploadedParts.length);

        const session = await readSession(meetingId);
        const pending = await readChunksFrom(meetingId, session?.firstPendingSeq ?? 0);
        bufferRef.current = pending;
        bufferBytesRef.current = pending.reduce((total, blob) => total + blob.size, 0);
        seqRef.current = (session?.firstPendingSeq ?? 0) + pending.length;
        lastElapsedRef.current = session?.durationMs ?? 0;
        setBytesBuffered(bufferBytesRef.current);
        setPhase("uploading");
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  return {
    phase,
    savedUpToMs,
    bytesBuffered,
    partsUploaded,
    error,
    addChunk,
    finish,
    abort,
    resume,
  };
}
