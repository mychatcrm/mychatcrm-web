"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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

/** Evita dois blocos de alerta quando falha de rede e sessão reportam o mesmo problema. */
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
  const errConfig = error?.toLowerCase().includes("sem evolution") || error?.toLowerCase().includes("evolution_api") || error?.toLowerCase().includes("webhook");

  if (infraHint && error && (errSession || errConfig)) {
    return { tone: "warning", primary: error!, secondary: infraHint };
  }

  if (infraHint && error && sessionErrorOverlapsInfra(infraHint, error)) {
    return {
      tone: "danger",
      primary:
        "Não conseguimos ligar ao servidor WhatsApp (Evolution). Confirme que o serviço na sua VPS está a correr e que o endereço nas definições do MyChatCRM está correto.",
      secondary: undefined,
    };
  }

  if (infraHint && error) {
    return { tone: "danger", primary: infraHint, secondary: error };
  }

  if (infraHint) return { tone: "danger", primary: infraHint };
  return { tone: "warning", primary: error! };
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
      ? "Ligado — o WhatsApp nesta linha está ativo."
      : connectionState === "none"
        ? "A preparar a sessão no servidor…"
        : connectionState
          ? `Estado: ${connectionState}`
          : "A sincronizar…";

  const unifiedAlert = useMemo(() => deriveUnifiedAlert(infraHint, error), [infraHint, error]);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
      <p className={typography.ui.overline}>WhatsApp por código QR</p>
      <p className="text-content">
        O código aparece aqui depois de o <strong className="text-content">servidor WhatsApp</strong> (Evolution) o gerar. O MyChatCRM pede o código por si e associa esta linha.
      </p>
      <p className="text-xs text-content-muted">Indicado para testes; empresas com número verificado costumam usar a API Meta nesta mesma página.</p>
      <details className="rounded-lg border border-line/60 bg-surface-deep/40 text-xs [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer px-3 py-2 font-medium text-content-muted">Detalhes para administrador</summary>
        <div className="space-y-2 border-t border-line/50 px-3 py-2 text-content-muted">
          <p>
            Ligação à API Evolution (<code className="rounded bg-surface-elevated/50 px-1 font-mono text-[10px]">/instance/connect</code>), instância por linha e registo no
            servidor MyChatCRM. Canal não oficial (Baileys): uso típico em testes.
          </p>
        </div>
      </details>
      {unifiedAlert ? (
        <div
          role="alert"
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            unifiedAlert.tone === "danger"
              ? "border-rose-500/35 bg-rose-500/10 text-rose-950 dark:text-rose-100"
              : "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-100",
          )}
        >
          <p className="font-medium leading-snug">{unifiedAlert.primary}</p>
          {unifiedAlert.secondary ? (
            <p className="mt-1.5 text-[11px] leading-snug opacity-95">{unifiedAlert.secondary}</p>
          ) : null}
        </div>
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
      ) : (connectionState === "close" || connectionState === "connecting") &&
        !qrDataUrl &&
        !busy &&
        (!error || Boolean(infraHint && sessionErrorOverlapsInfra(infraHint, error))) ? (
        <div className="space-y-2">
          <p className="text-xs text-content-faint">A aguardar o código QR do servidor. Pode demorar alguns segundos.</p>
          <details className="text-xs text-content-faint [&_summary::-webkit-details-marker]:hidden">
            <summary className="cursor-pointer font-medium text-content-muted">Ainda vazio?</summary>
            <p className="mt-1 pl-0 text-[11px] leading-relaxed">
              Veja os logs do container Evolution e confirme que a resposta inclui imagem em <code className="font-mono text-[10px]">base64</code>,{" "}
              <code className="font-mono text-[10px]">qrcode</code> ou <code className="font-mono text-[10px]">code</code>.
            </p>
          </details>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void startOrRefreshSession()}>
          {busy ? "A aguardar…" : "Gerar ou atualizar código QR"}
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
