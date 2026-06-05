"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Smartphone, WifiOff } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

type SessionJson = {
  instanceName?: string | null;
  connectionState?: string;
  qrDataUrl?: string | null;
  pairingCode?: string | null;
  waJid?: string | null;
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
      "Servidor sem Evolution configurada (EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY ou AUTHENTICATION_API_KEY, e EVOLUTION_WEBHOOK_SECRET). O QR vem da Evolution na VPS — defina as variáveis no .env.local / Vercel."
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

function sessionErrorOverlapsInfra(infra: string, err: string | null): boolean {
  if (!err) return false;
  const i = infra.toLowerCase();
  const e = err.toLowerCase();
  if (!i || !e) return false;
  if (i.includes("não conseguiu contactar") || i.includes("nao conseguiu contactar")) {
    if (e.includes("502") || e.includes("vps") || e.includes("evolution") || e.includes("ligar a inst")) return true;
  }
  if (e.includes("502") && (i.includes("vps") || i.includes("contactar"))) return true;
  return false;
}

type UnifiedAlert = { tone: "danger" | "warning"; primary: string; secondary?: string };

function deriveUnifiedAlert(infraHint: string | null, error: string | null): UnifiedAlert | null {
  if (!infraHint && !error) return null;
  const errSession = error?.toLowerCase().includes("sessão") || error?.toLowerCase().includes("sessao");
  const errConfig =
    error?.toLowerCase().includes("sem evolution") ||
    error?.toLowerCase().includes("evolution_api") ||
    error?.toLowerCase().includes("webhook");
  if (infraHint && error && (errSession || errConfig)) {
    return { tone: "warning", primary: error!, secondary: infraHint };
  }
  if (infraHint && error && sessionErrorOverlapsInfra(infraHint, error)) {
    return {
      tone: "danger",
      primary:
        "Não conseguimos ligar ao servidor WhatsApp (Evolution). Confirme que o serviço na sua VPS está a correr e que o endereço nas definições do MyChatCRM está correto.",
    };
  }
  if (infraHint && error) return { tone: "danger", primary: infraHint, secondary: error };
  if (infraHint) return { tone: "danger", primary: infraHint };
  return { tone: "warning", primary: error! };
}

const QR_TTL_SECONDS = 60;

function formatWaNumber(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const num = jid.split("@")[0];
  if (!num || num.length < 8) return null;
  return `+${num}`;
}

export function EvolutionQrSlotPanel({
  slotIndex,
  sessionApiPath = "/api/client/whatsapp/evolution/session",
  statusApiPath = "/api/client/whatsapp/evolution/status",
}: {
  slotIndex: number;
  sessionApiPath?: string;
  statusApiPath?: string;
}) {
  const { isLight } = usePanelAppearance();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrReceivedAtRef = useRef<number | null>(null);
  const prevQrFingerprintRef = useRef<string | null>(null);
  const imgAltId = useId();

  const [connectionState, setConnectionState] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [waJid, setWaJid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infraHint, setInfraHint] = useState<string | null>(null);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(QR_TTL_SECONDS);
  // Entrance animation flag for connected state
  const [connectedVisible, setConnectedVisible] = useState(false);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Fade+scale entrance for connected card
  useEffect(() => {
    if (connectionState !== "open") {
      setConnectedVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setConnectedVisible(true));
    return () => cancelAnimationFrame(id);
  }, [connectionState]);

  // QR countdown
  useEffect(() => {
    if (!qrDataUrl || connectionState === "open") return;
    const id = setInterval(() => {
      if (!qrReceivedAtRef.current) return;
      const elapsed = Math.floor((Date.now() - qrReceivedAtRef.current) / 1000);
      setQrSecondsLeft(Math.max(0, QR_TTL_SECONDS - elapsed));
    }, 1_000);
    return () => clearInterval(id);
  }, [qrDataUrl, connectionState]);

  const applySessionPayload = useCallback((res: Response, j: SessionJson) => {
    if (!res.ok) {
      setPairingCode(null);
      setError(friendlyHttpError(res.status, j));
      return;
    }
    setError(null);
    const rawSt = j.connectionState;
    const st = typeof rawSt === "string" && rawSt.trim() ? rawSt.trim() : "close";
    setConnectionState(st);
    setQrDataUrl(typeof j.qrDataUrl === "string" ? j.qrDataUrl : null);
    setPairingCode(
      typeof j.pairingCode === "string" && j.pairingCode.trim()
        ? j.pairingCode.trim().toUpperCase()
        : null,
    );
    if (j.waJid) setWaJid(j.waJid);
    // Reset countdown only when QR image actually changes
    if (j.qrDataUrl) {
      const fingerprint = j.qrDataUrl.slice(-60);
      if (fingerprint !== prevQrFingerprintRef.current) {
        prevQrFingerprintRef.current = fingerprint;
        qrReceivedAtRef.current = Date.now();
        setQrSecondsLeft(QR_TTL_SECONDS);
      }
    } else {
      prevQrFingerprintRef.current = null;
      qrReceivedAtRef.current = null;
      setQrSecondsLeft(QR_TTL_SECONDS);
    }
    if (j.detail && !j.qrDataUrl && res.ok) {
      setError((prev) => prev ?? `Evolution (VPS): ${j.detail}`);
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`${sessionApiPath}?slotIndex=${slotIndex}`, {
      credentials: "same-origin",
    });
    const j = await readSessionJson(res);
    applySessionPayload(res, j);
    if ((j.connectionState ?? "") === "open") clearPoll();
  }, [applySessionPayload, clearPoll, slotIndex]);

  const startOrRefreshSession = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(sessionApiPath, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex }),
      });
      const j = await readSessionJson(res);
      applySessionPayload(res, j);
      if (!res.ok) setQrDataUrl(null);
    } finally {
      setBusy(false);
    }
  }, [applySessionPayload, slotIndex]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      await fetch(`${sessionApiPath}?slotIndex=${slotIndex}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      setConnectionState("close");
      setQrDataUrl(null);
      setPairingCode(null);
      setWaJid(null);
      setError(null);
      prevQrFingerprintRef.current = null;
      qrReceivedAtRef.current = null;
      setQrSecondsLeft(QR_TTL_SECONDS);
    } finally {
      setDisconnecting(false);
    }
    await startOrRefreshSession();
  }, [slotIndex, startOrRefreshSession]);

  // Infra check on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stRes = await fetch(statusApiPath, { credentials: "same-origin" });
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

  // Initial session load + auto-start
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`${sessionApiPath}?slotIndex=${slotIndex}`, {
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

  // Polling while not connected
  useEffect(() => {
    clearPoll();
    if (connectionState === "open") return;
    pollRef.current = setInterval(() => {
      void refresh();
    }, 3_000);
    return clearPoll;
  }, [connectionState, refresh, clearPoll]);

  const unifiedAlert = useMemo(() => deriveUnifiedAlert(infraHint, error), [infraHint, error]);
  const waNumber = formatWaNumber(waJid);

  const countdownColor =
    qrSecondsLeft > 30
      ? "text-emerald-600 dark:text-emerald-400"
      : qrSecondsLeft > 15
        ? "text-amber-500 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";

  // ── CONNECTED STATE ───────────────────────────────────────────────────────
  if (connectionState === "open") {
    return (
      <div
        className={cn(
          "rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-5 text-center",
          "transition-all duration-500 ease-out",
          connectedVisible
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-2 scale-[0.98]",
        )}
        role="status"
        aria-live="polite"
      >
        <div className="mb-3 flex justify-center">
          <div className="rounded-full bg-emerald-500/15 p-3">
            <CheckCircle2
              className="size-10 text-emerald-500"
              strokeWidth={1.5}
              aria-hidden
            />
          </div>
        </div>
        <p className="text-lg font-bold text-content">WhatsApp Conectado</p>
        {waNumber ? (
          <p className="mt-1 font-mono text-sm font-medium text-content-secondary">{waNumber}</p>
        ) : (
          <p className="mt-1 text-sm text-content-secondary">Sessão ativa</p>
        )}
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          As mensagens recebidas são processadas automaticamente.
        </p>
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={disconnecting}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            {disconnecting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <WifiOff className="size-3.5" aria-hidden />
            )}
            {disconnecting ? "A desligar…" : "Desconectar"}
          </button>
        </div>
      </div>
    );
  }

  // ── OTHER STATES ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
      <p className={typography.ui.overline}>WhatsApp por código QR</p>
      <p className="text-content">
        O código aparece aqui depois de o{" "}
        <strong className="text-content">servidor WhatsApp</strong> (Evolution) o gerar. O
        MyChatCRM pede o código por si e associa esta linha.
      </p>
      <p className="text-xs text-content-muted">
        Indicado para testes; empresas com número verificado costumam usar a API Meta nesta mesma
        página.
      </p>
      <details className="rounded-lg border border-line/60 bg-surface-deep/40 text-xs [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer px-3 py-2 font-medium text-content-muted">
          Detalhes para administrador
        </summary>
        <div className="space-y-2 border-t border-line/50 px-3 py-2 text-content-muted">
          <p>
            Ligação à API Evolution (
            <code className="rounded bg-surface-elevated/50 px-1 font-mono text-[10px]">
              /instance/connect
            </code>
            ), instância por linha e registo no servidor MyChatCRM. Canal não oficial (Baileys):
            uso típico em testes.
          </p>
        </div>
      </details>

      {/* ── Infra alert (infraHint with or without session error) ── */}
      {infraHint && unifiedAlert ? (
        <div
          role="alert"
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            unifiedAlert.tone === "danger"
              ? "border-rose-500/35 bg-rose-500/10 text-rose-950 dark:text-rose-100"
              : "border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-50",
          )}
        >
          <p className="font-medium leading-snug">{unifiedAlert.primary}</p>
          {unifiedAlert.secondary ? (
            <p className="mt-1.5 text-[11px] font-medium leading-snug text-amber-950/90 dark:text-amber-50/95">
              {unifiedAlert.secondary}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── Standalone error card (no infra hint) ── */}
      {error && !infraHint ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/35 bg-rose-500/[0.07] px-4 py-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-rose-500"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div>
                <p className="font-semibold text-rose-700 dark:text-rose-300">
                  Ocorreu um erro
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-rose-600/90 dark:text-rose-300/80">
                  {error}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void startOrRefreshSession()}
              >
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden />
                {busy ? "A tentar…" : "Tentar novamente"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {busy && !qrDataUrl && !error ? (
        <div className="space-y-3 py-1">
          <div className="flex items-center gap-2 text-xs text-content-secondary">
            <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
            <span>A gerar QR Code…</span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="h-[228px] w-[228px] animate-pulse rounded-xl bg-surface-elevated/50" />
            <div className="h-3 w-44 animate-pulse rounded-full bg-surface-elevated/50" />
            <div className="h-2.5 w-32 animate-pulse rounded-full bg-surface-elevated/40" />
          </div>
        </div>
      ) : null}

      {/* ── Pairing code ── */}
      {pairingCode && connectionState !== "open" && !qrDataUrl ? (
        <div className="rounded-lg border border-info/30 bg-info/10 px-3 py-3 text-sm text-content">
          <p className="font-semibold text-content">Código de emparelhamento</p>
          <p className="mt-1 text-xs leading-relaxed text-content-secondary">
            No WhatsApp no telemóvel:{" "}
            <strong className="text-content">Definições</strong> →{" "}
            <strong className="text-content">Aparelhos ligados</strong> →{" "}
            <strong className="text-content">Ligar um aparelho</strong> → escolha{" "}
            <strong className="text-content">ligar com número</strong> (ou equivalente) e
            introduza:
          </p>
          <p
            className="mt-3 text-center font-mono text-2xl font-bold tracking-[0.35em] text-content"
            translate="no"
          >
            {pairingCode}
          </p>
          <p className="mt-2 text-[11px] text-content-muted">
            Se a Evolution só devolver o token interno sem imagem, este código é a forma suportada
            de ligar o aparelho.
          </p>
        </div>
      ) : null}

      {/* ── QR Code ── */}
      {qrDataUrl && connectionState !== "open" ? (
        <div className="flex flex-col items-center gap-3 py-1">
          {/* Pulsing "waiting" badge */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-info/35 bg-info/10 px-3 py-1 text-xs font-medium text-info">
            <span
              className="h-1.5 w-1.5 rounded-full bg-info animate-pulse"
              aria-hidden
            />
            Aguardando leitura…
          </span>

          {/* QR frame with shadow */}
          <div
            className={cn(
              "relative overflow-hidden rounded-xl border-2 p-2.5 transition-all duration-300",
              isLight
                ? "border-slate-200 bg-white"
                : "border-line/60 bg-white",
              qrSecondsLeft <= 15 && "border-amber-400/70",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Código QR gerado pela Evolution API"
              width={220}
              height={220}
              className="block rounded-lg"
              aria-describedby={imgAltId}
            />
            {/* Expiry overlay at ≤ 10 seconds */}
            {qrSecondsLeft <= 10 && qrSecondsLeft > 0 ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55">
                <div className="rounded-xl bg-surface-card/95 px-5 py-4 text-center">
                  <p className="text-xs font-medium text-content-secondary">QR expira em</p>
                  <p className={cn("mt-0.5 text-3xl font-bold tabular-nums", countdownColor)}>
                    {qrSecondsLeft}s
                  </p>
                  <p className="mt-1 text-[11px] text-content-muted">A renovar…</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Instructions */}
          <div className="max-w-[264px] rounded-lg border border-line/50 bg-surface-elevated/30 px-3 py-2.5 text-center">
            <div className="mb-1 flex items-center justify-center gap-1.5">
              <Smartphone className="size-3.5 shrink-0 text-content-muted" aria-hidden />
              <p className="text-xs font-semibold text-content">Como escanear</p>
            </div>
            <p id={imgAltId} className="text-[11px] leading-relaxed text-content-muted">
              Abra o <strong className="text-content-secondary">WhatsApp</strong> →{" "}
              <strong className="text-content-secondary">Dispositivos conectados</strong> →{" "}
              <strong className="text-content-secondary">Conectar dispositivo</strong>
            </p>
          </div>

          {/* Countdown (normal range) */}
          {qrSecondsLeft > 10 ? (
            <p className="text-xs text-content-muted">
              QR válido por mais{" "}
              <span className={cn("font-semibold tabular-nums", countdownColor)}>
                {qrSecondsLeft}s
              </span>
            </p>
          ) : null}
        </div>
      ) : !busy && !qrDataUrl && !error &&
        (connectionState === "close" || connectionState === "connecting") ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-content-faint">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            <span>A aguardar o código QR do servidor…</span>
          </div>
          <details className="text-xs text-content-faint [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer font-medium text-content-muted">
              Ainda vazio?
            </summary>
            <p className="mt-1 text-[11px] leading-relaxed">
              Veja os logs do container Evolution e confirme que a resposta inclui imagem em{" "}
              <code className="font-mono text-[10px]">base64</code>,{" "}
              <code className="font-mono text-[10px]">qrcode</code> ou{" "}
              <code className="font-mono text-[10px]">code</code>.
            </p>
          </details>
        </div>
      ) : null}

      {/* ── Status label ── */}
      {!error || infraHint ? (
        <p className="text-xs text-content-muted">
          {connectionState === "open"
            ? "Ligado — o WhatsApp nesta linha está ativo."
            : connectionState === "none"
              ? "A preparar a sessão no servidor…"
              : connectionState
                ? `Estado: ${connectionState}`
                : "A sincronizar…"}
        </p>
      ) : null}

      {/* ── Action buttons (hidden while loading) ── */}
      {!busy ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void startOrRefreshSession()}
          >
            Gerar ou atualizar código QR
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
      ) : null}
    </div>
  );
}
