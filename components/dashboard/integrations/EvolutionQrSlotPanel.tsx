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

type EvolutionStatusJson = {
  evolutionConfigured?: boolean;
  webhookSecretSet?: boolean;
  evolutionReachable?: boolean | null;
  evolutionPingError?: string | null;
};

async function readSessionJson(res: Response): Promise<SessionJson> {
  try {
    return (await res.json()) as SessionJson;
  } catch {
    return {};
  }
}

function friendlyHttpError(status: number, j: SessionJson): string {
  if (status === 503) {
    return (
      j.error ??
      "Servidor sem Evolution configurada (EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY ou EVOLUTION_WEBHOOK_SECRET). O QR é sempre gerado na tua Evolution na VPS — defina as variáveis no deploy."
    );
  }
  if (status === 502) {
    return j.error ?? j.detail ?? "A VPS Evolution devolveu erro ao criar ou ligar a instância. Verifique a API e os logs do container.";
  }
  if (status === 401) {
    return "Sessão expirada. Volte a iniciar sessão.";
  }
  return j.error ?? j.detail ?? `Erro ${status}`;
}

export function EvolutionQrSlotPanel({ slotIndex }: { slotIndex: number }) {
  const { isLight } = usePanelAppearance();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgAltId = useId();

  const [connectionState, setConnectionState] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infraHint, setInfraHint] = useState<string | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const applySessionPayload = useCallback((res: Response, j: SessionJson) => {
    if (!res.ok) {
      setError(friendlyHttpError(res.status, j));
      return;
    }
    setError(null);
    const st = j.connectionState ?? "";
    setConnectionState(st);
    setQrDataUrl(typeof j.qrDataUrl === "string" ? j.qrDataUrl : null);
    if (j.detail && !j.qrDataUrl && res.ok) {
      setError((prev) => prev ?? `Evolution (VPS): ${j.detail}`);
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/client/whatsapp/evolution/session?slotIndex=${slotIndex}`, {
      credentials: "same-origin",
    });
    const j = await readSessionJson(res);
    applySessionPayload(res, j);
    if ((j.connectionState ?? "") === "open") clearPoll();
  }, [applySessionPayload, slotIndex]);

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
      applySessionPayload(res, j);
      if (!res.ok) {
        setQrDataUrl(null);
      }
    } finally {
      setBusy(false);
    }
  }, [applySessionPayload, slotIndex]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stRes = await fetch("/api/client/whatsapp/evolution/status", { credentials: "same-origin" });
        const st = (await stRes.json().catch(() => ({}))) as EvolutionStatusJson;
        if (cancelled) return;
        if (stRes.ok && st.evolutionConfigured && st.evolutionReachable === false) {
          setInfraHint(
            `A aplicação não conseguiu contactar a Evolution na VPS (${st.evolutionPingError ?? "erro desconhecido"}). Verifique firewall, URL base da API e se o processo está a correr.`,
          );
        } else {
          setInfraHint(null);
        }
      } catch {
        if (!cancelled) setInfraHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/client/whatsapp/evolution/session?slotIndex=${slotIndex}`, {
        credentials: "same-origin",
      });
      const j = await readSessionJson(res);
      if (cancelled) return;
      applySessionPayload(res, j);
      if (cancelled) return;
      const st = j.connectionState ?? "";
      const hasQr = Boolean(j.qrDataUrl);
      if (res.ok && (st === "none" || (!hasQr && st !== "open"))) {
        await startOrRefreshSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySessionPayload, slotIndex, startOrRefreshSession]);

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
      ? "Ligado ao WhatsApp (QR gerado pela Evolution na VPS)"
      : connectionState === "none"
        ? "Sem sessão no servidor — a criar na Evolution…"
        : connectionState
          ? `Estado Evolution: ${connectionState}`
          : "A sincronizar com a Evolution…";

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
      <p className={typography.ui.overline}>WhatsApp por QR — Evolution API (VPS)</p>
      <p className="text-content">
        O código QR é <strong className="text-content">sempre obtido da tua Evolution</strong> via API (<code className="text-xs">/instance/connect</code>
        ). O MyChatCRM só orquestra instância por linha e grava o mapeamento no servidor.
      </p>
      <p className="text-xs text-content-muted">
        Canal não oficial (Baileys): adequado para testes; produção com número verificado deve preferir a API Meta.
      </p>
      {infraHint ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-950 dark:text-rose-100">{infraHint}</p>
      ) : null}
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
            alt="Código QR gerado pela Evolution API na VPS"
            width={220}
            height={220}
            className="rounded-lg border border-line bg-white p-2"
            aria-describedby={imgAltId}
          />
          <p id={imgAltId} className="text-center text-xs text-content-muted">
            Abra o WhatsApp no telemóvel → Definições → Aparelhos ligados → Ligar um aparelho → escaneie este código.
          </p>
        </div>
      ) : (connectionState === "close" || connectionState === "connecting") && !qrDataUrl && !error && !busy ? (
        <p className="text-xs text-content-faint">
          A aguardar imagem QR da Evolution na VPS. Se continuar vazio, veja os logs do container e confirme o formato da resposta (
          <code className="text-[10px]">base64</code> / <code className="text-[10px]">qrcode</code> / <code className="text-[10px]">code</code>).
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void startOrRefreshSession()}>
          {busy ? "A aguardar…" : "Gerar / atualizar QR (Evolution)"}
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
