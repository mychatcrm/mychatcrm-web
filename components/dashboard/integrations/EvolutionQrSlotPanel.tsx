"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

type SessionJson = {
  instanceName?: string | null;
  connectionState?: string;
  qrDataUrl?: string | null;
  error?: string;
  detail?: string;
};

async function readSessionJson(res: Response): Promise<SessionJson> {
  try {
    return (await res.json()) as SessionJson;
  } catch {
    return {};
  }
}

export function EvolutionQrSlotPanel({ slotIndex }: { slotIndex: number }) {
  const { isLight } = usePanelAppearance();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgAltId = useId();

  const [connectionState, setConnectionState] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/client/whatsapp/evolution/session?slotIndex=${slotIndex}`, {
      credentials: "same-origin",
    });
    const j = await readSessionJson(res);
    if (!res.ok) {
      setError(j.error ?? `Erro ${res.status}`);
      return;
    }
    setError(null);
    const st = j.connectionState ?? "";
    setConnectionState(st);
    setQrDataUrl(typeof j.qrDataUrl === "string" ? j.qrDataUrl : null);
    if (st === "open") clearPoll();
  }, [slotIndex]);

  const startOrRefreshSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/client/whatsapp/evolution/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex }),
      });
      const j = await readSessionJson(res);
      if (!res.ok) {
        setError(j.error ?? j.detail ?? `Erro ${res.status}`);
        setQrDataUrl(null);
        return;
      }
      const st = j.connectionState ?? "";
      setConnectionState(st);
      setQrDataUrl(typeof j.qrDataUrl === "string" ? j.qrDataUrl : null);
      if (j.detail && !j.qrDataUrl) {
        setError((prev) => prev ?? `Evolution: ${j.detail}`);
      }
    } finally {
      setBusy(false);
    }
  }, [slotIndex]);

  useEffect(() => {
    void startOrRefreshSession();
  }, [startOrRefreshSession]);

  useEffect(() => {
    clearPoll();
    if (connectionState === "open") return;
    pollRef.current = setInterval(() => {
      void refresh();
    }, 3000);
    return clearPoll;
  }, [connectionState, refresh]);

  const statusLabel =
    connectionState === "open"
      ? "Ligado ao WhatsApp (Evolution)"
      : connectionState === "none"
        ? "Sem sessão no servidor"
        : connectionState
          ? `Estado: ${connectionState}`
          : "A preparar…";

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
      <p className={typography.ui.overline}>WhatsApp por QR (Evolution API) — linha {slotIndex + 1}</p>
      <p className="text-content">
        Canal não oficial: use para testes; produção deve preferir a API Meta.{" "}
        <span className="text-content-muted">Requer variáveis Evolution no servidor.</span>
      </p>
      {error ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-content-muted">{statusLabel}</p>
      {qrDataUrl && connectionState !== "open" ? (
        <div className="flex flex-col items-center gap-2">
          {/* Data URL dinâmico da Evolution — next/image não aplica aqui. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Código QR para ligar o WhatsApp"
            width={220}
            height={220}
            className="rounded-lg border border-line bg-white p-2"
            aria-describedby={imgAltId}
          />
          <p id={imgAltId} className="text-center text-xs text-content-muted">
            Abra o WhatsApp no telemóvel → Definições → Aparelhos ligados → Ligar um aparelho → escaneie este código.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void startOrRefreshSession()}>
          {busy ? "A aguardar…" : "Gerar / atualizar QR"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          className={cn(isLight && "border-slate-300")}
          onClick={() => void refresh()}
        >
          Ver estado
        </Button>
      </div>
    </div>
  );
}
