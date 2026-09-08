"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mic, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { PanelInput } from "@/components/panel/ui/PanelInput";
import { PanelSelect } from "@/components/panel/ui/PanelSelect";
import {
  MEETING_FILE_ACCEPT_ATTRIBUTE,
  isAcceptedAudioMimeType,
  pickSupportedRecorderMimeType,
} from "@/lib/meetings/audio-formats";
import { MEETING_TEMPLATE_KEYS, MEETING_TEMPLATE_LABEL } from "@/lib/ai/prompts/meeting-analysis";
import { formatBytes } from "./meeting-format";

const CONSENT_KEY = "mychatcrm_meetings_consent";

export type NewMeetingResult =
  | { kind: "record"; meetingId: string; mimeType: string }
  | { kind: "upload"; meetingId: string; mimeType: string; file: File };

/**
 * Porta de entrada do módulo.
 *
 * Gravar e enviar arquivo ficam LADO A LADO, com o mesmo peso visual. No iPhone
 * o upload do gravador nativo é o único caminho que sobrevive à tela bloqueada,
 * então tratá-lo como plano B empurraria o usuário para o caminho que falha.
 */
export function NewMeetingModal({
  open,
  onClose,
  onReady,
}: {
  open: boolean;
  onClose: () => void;
  onReady: (result: NewMeetingResult) => void;
}) {
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState<string>("geral");
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    try {
      const accepted = window.localStorage.getItem(CONSENT_KEY) === "1";
      setNeedsConsent(!accepted);
      setConsentAcknowledged(accepted);
    } catch {
      // Navegador sem storage: pede o aceite de novo. Repetir o aviso é o erro
      // menos grave dos dois.
      setNeedsConsent(true);
    }
  }, [open]);

  const createMeeting = useCallback(
    async (mimeType: string, source: "record" | "upload") => {
      const response = await fetch("/api/client/reunioes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          mimeType,
          title: title.trim(),
          meetingType,
          consentAcknowledged: true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Não foi possível criar a reunião.",
        );
      }
      try {
        window.localStorage.setItem(CONSENT_KEY, "1");
      } catch {
        /* sem storage: o aviso aparece de novo, e tudo bem */
      }
      return (body.meeting as { id: string }).id;
    },
    [meetingType, title],
  );

  const startRecording = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // O formato precisa ser conhecido ANTES de criar a reunião: ele define a
      // extensão da chave no storage, que o servidor carimba e valida.
      const mimeType =
        typeof MediaRecorder !== "undefined"
          ? pickSupportedRecorderMimeType((type) => MediaRecorder.isTypeSupported(type))
          : null;

      if (!mimeType) {
        setError(
          "Este navegador não grava áudio. Use Chrome, Edge, Firefox ou Safari atualizado — ou envie um arquivo.",
        );
        return;
      }

      const meetingId = await createMeeting(mimeType.split(";")[0] ?? mimeType, "record");
      onReady({ kind: "record", meetingId, mimeType: mimeType.split(";")[0] ?? mimeType });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a reunião.");
    } finally {
      setBusy(false);
    }
  }, [createMeeting, onReady]);

  const pickFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const mimeType = file.type || "audio/mpeg";
        if (!isAcceptedAudioMimeType(mimeType)) {
          setError(`Formato não suportado (${mimeType || "desconhecido"}). Envie MP3, M4A, WAV, AAC, OGG ou MP4.`);
          return;
        }
        const meetingId = await createMeeting(mimeType, "upload");
        onReady({ kind: "upload", meetingId, mimeType, file });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível criar a reunião.");
      } finally {
        setBusy(false);
      }
    },
    [createMeeting, onReady],
  );

  return (
    <Modal open={open} onClose={onClose} title="Nova reunião">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-content-secondary" htmlFor="meeting-title">
            Título <span className="font-normal text-content-faint">(opcional)</span>
          </label>
          <PanelInput
            id="meeting-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex.: Alinhamento comercial — João"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-content-secondary" htmlFor="meeting-type">
            Tipo de reunião
          </label>
          <PanelSelect
            id="meeting-type"
            value={meetingType}
            onChange={(event) => setMeetingType(event.target.value)}
          >
            {MEETING_TEMPLATE_KEYS.map((key) => (
              <option key={key} value={key}>
                {MEETING_TEMPLATE_LABEL[key]}
              </option>
            ))}
          </PanelSelect>
          <p className="text-[11px] text-content-muted">
            Define o que a IA vai procurar. Pode ser trocado depois.
          </p>
        </div>

        {needsConsent ? (
          <label className="flex items-start gap-2 rounded-panel-xl border border-line/45 bg-surface-elevated/30 p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consentAcknowledged}
              onChange={(event) => setConsentAcknowledged(event.target.checked)}
            />
            <span className="text-xs leading-relaxed text-content-secondary">
              Grave apenas conversas das quais você participa e informe os participantes de que a
              conversa está sendo gravada. Você é responsável pelo conteúdo gravado.
            </span>
          </label>
        ) : null}

        {error ? (
          <p className="rounded-panel-xl border border-error/30 bg-error/[0.06] px-3 py-2 text-xs text-content">
            {error}
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <PanelButton
            size="md"
            onClick={startRecording}
            disabled={busy || (needsConsent && !consentAcknowledged)}
            className="justify-center"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
            Gravar agora
          </PanelButton>

          <label
            className={
              "flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-line/45 bg-surface-card/70 px-7 py-3.5 text-sm text-content-secondary transition-colors hover:border-line/60 hover:bg-surface-elevated/45 hover:text-content " +
              (busy || (needsConsent && !consentAcknowledged) ? "pointer-events-none opacity-60" : "")
            }
          >
            <Upload className="h-4 w-4" aria-hidden />
            Enviar áudio
            <input
              type="file"
              className="sr-only"
              accept={MEETING_FILE_ACCEPT_ATTRIBUTE}
              onChange={(event) => void pickFile(event.target.files?.[0])}
              disabled={busy || (needsConsent && !consentAcknowledged)}
            />
          </label>
        </div>

        <p className="text-[11px] leading-relaxed text-content-muted">
          No celular, enviar um áudio já gravado pelo aplicativo Gravador é o caminho mais seguro
          para reuniões longas: gravar pelo navegador exige manter esta tela aberta.
          {" "}
          Tamanho máximo por arquivo: {formatBytes(500 * 1024 * 1024)}.
        </p>
      </div>
    </Modal>
  );
}
