"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BadgeCheck, Check, ChevronDown, ExternalLink, Loader2, Plug, QrCode, Share2, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Modal } from "@/components/ui/Modal";
import { cn, formatBRL } from "@/lib/utils";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "@/lib/plans";
import { readExtraSlotsSummary, whatsappExtraSlotsStorageKey, WHATSAPP_EXTRAS_UPDATED_EVENT } from "@/lib/whatsapp-extra-numbers-storage";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import {
  readWhatsAppSlotMethods,
  setWhatsAppSlotMethod,
  WHATSAPP_CONNECTION_UPDATED_EVENT,
  whatsappConnectionWatchableStorageKeys,
} from "@/lib/whatsapp-connection-storage";
import { typography } from "@/lib/typography";
import { EvolutionQrSlotPanel } from "@/components/dashboard/integrations/EvolutionQrSlotPanel";
import type { MetaStatusPage, MetaStatusResponse } from "@/app/api/client/meta/status/route";
import type { Agent } from "@/lib/types";

// FB JS SDK global — loaded dynamically for the WhatsApp Embedded Signup popup.
declare global {
  interface Window {
    FB?: {
      init: (params: object) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
        params: object,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

function loadFbSdk(appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v24.0" });
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("FB SDK load timeout")), 15_000);
    window.fbAsyncInit = () => {
      clearTimeout(timer);
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v24.0" });
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("FB SDK failed to load"));
    };
    document.head.appendChild(script);
  });
}

function safeRun<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function IntegracoesHub({ tenantId }: { tenantId: string }) {
  const { isLight } = usePanelAppearance();
  const [revision, setRevision] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Meta Lead Ads state ───────────────────────────────────────────────────
  const [metaStatus, setMetaStatus] = useState<MetaStatusResponse | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaDisconnecting, setMetaDisconnecting] = useState(false);
  const [agents, setAgents] = useState<Pick<Agent, "id" | "nome">[]>([]);
  const [formMappingSaving, setFormMappingSaving] = useState<Record<string, boolean>>({});
  const [formMappingValues, setFormMappingValues] = useState<Record<string, string>>({});
  const [metaBanner, setMetaBanner] = useState<string | null>(null);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);

  // ── WhatsApp Cloud API (Embedded Signup) state ───────────────────────────
  type WaCloudState =
    | { connected: false }
    | { connected: true; phone_number_id: string; display_phone: string | null; verified_name: string | null };
  const [waCloudStatus, setWaCloudStatus] = useState<WaCloudState | null>(null);
  const [waCloudLoading, setWaCloudLoading] = useState(true);
  const [waCloudConnecting, setWaCloudConnecting] = useState(false);
  const [waCloudDisconnecting, setWaCloudDisconnecting] = useState(false);
  const [waCloudBanner, setWaCloudBanner] = useState<string | null>(null);
  // Pre-loaded SDK config so FB.login() can be called synchronously on click
  const waCloudConfigRef = useRef<{ app_id: string; config_id: string } | null>(null);
  // Why the SDK pre-load failed (ad blocker, CDN down) — shown on click for a precise message
  const waCloudSdkErrorRef = useRef<string | null>(null);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    bump();
  }, [bump, tenantId]);

  useEffect(() => {
    const onWa = () => bump();
    window.addEventListener(WHATSAPP_CONNECTION_UPDATED_EVENT, onWa);
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (whatsappConnectionWatchableStorageKeys(tenantId).includes(e.key)) onWa();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(WHATSAPP_CONNECTION_UPDATED_EVENT, onWa);
      window.removeEventListener("storage", onStorage);
    };
  }, [bump, tenantId]);

  useEffect(() => {
    const onWaExtras = () => bump();
    window.addEventListener(WHATSAPP_EXTRAS_UPDATED_EVENT, onWaExtras);
    return () => window.removeEventListener(WHATSAPP_EXTRAS_UPDATED_EVENT, onWaExtras);
  }, [bump]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === whatsappExtraSlotsStorageKey(tenantId) ||
        whatsappConnectionWatchableStorageKeys(tenantId).includes(e.key)
      ) {
        bump();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [bump, tenantId]);

  // ── Load Meta status on mount / after OAuth redirect ─────────────────────
  const loadMetaStatus = useCallback(async (): Promise<MetaStatusResponse | null> => {
    setMetaLoading(true);
    try {
      const res = await fetch("/api/client/meta/status", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to load Meta status");

      const data = (await res.json()) as MetaStatusResponse;
      const pages = data.pages ?? [];
      const nextStatus = { connected: pages.length > 0, pages } satisfies MetaStatusResponse;
      setMetaStatus(nextStatus);

      // Initialize form mapping values from DB
      const initValues: Record<string, string> = {};
      for (const page of pages) {
        for (const form of page.forms) {
          if (form.agent_id) initValues[form.form_id] = form.agent_id;
        }
      }
      setFormMappingValues(initValues);
      return nextStatus;
    } catch {
      // Non-critical — Meta section degrades gracefully
      setMetaStatus({ connected: false, pages: [] });
      setFormMappingValues({});
      return null;
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetaStatus();
  }, [loadMetaStatus]);

  // ── WhatsApp Cloud status ─────────────────────────────────────────────────
  const loadWaCloudStatus = useCallback(async (): Promise<WaCloudState | null> => {
    setWaCloudLoading(true);
    try {
      const res = await fetch("/api/client/whatsapp-cloud/status", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to load WhatsApp Cloud status");
      const data = (await res.json()) as WaCloudState;
      setWaCloudStatus(data);
      return data;
    } catch {
      setWaCloudStatus({ connected: false });
      return null;
    } finally {
      setWaCloudLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWaCloudStatus();
  }, [loadWaCloudStatus]);

  // Pre-load the FB SDK as soon as we know the tenant hasn't connected yet.
  // This ensures window.FB is ready before the user clicks, so FB.login() can
  // be called synchronously within the user-gesture context (no popup blocker).
  useEffect(() => {
    if (waCloudStatus?.connected !== false) return;
    if (waCloudConfigRef.current) return; // already loaded
    void (async () => {
      try {
        const res = await fetch("/api/client/whatsapp-cloud/sdk-config", { credentials: "same-origin" });
        if (!res.ok) {
          waCloudSdkErrorRef.current = `sdk-config ${res.status}`;
          return;
        }
        const cfg = (await res.json()) as { app_id: string; config_id: string };
        await loadFbSdk(cfg.app_id);
        waCloudConfigRef.current = cfg;
        waCloudSdkErrorRef.current = null;
      } catch (err) {
        waCloudSdkErrorRef.current = err instanceof Error ? err.message : String(err);
      }
    })();
  }, [waCloudStatus]);

  // Show banner if redirected back from OAuth
  useEffect(() => {
    const meta = searchParams.get("meta");
    if (meta === "connected") {
      void loadMetaStatus().then((status) => {
        setMetaBanner(status?.pages.length ? "✅ Páginas Meta conectadas com sucesso!" : "Nenhuma página Facebook encontrada nesta conta.");
      });
    } else if (meta === "denied") {
      setMetaBanner("Autorização cancelada no Facebook. Tente novamente.");
    } else if (meta === "no_pages") {
      setMetaBanner("Nenhuma página Facebook encontrada nesta conta.");
    } else if (meta === "error") {
      setMetaBanner("Erro ao conectar com a Meta. Tente novamente.");
    }
  }, [searchParams, loadMetaStatus]);

  useEffect(() => {
    const wa = searchParams.get("whatsapp");
    if (wa === "connected") {
      void loadWaCloudStatus().then((status) => {
        setWaCloudBanner(status?.connected ? "✅ WhatsApp API Oficial conectado com sucesso!" : "Nenhum número WhatsApp Business encontrado.");
      });
    } else if (wa === "denied") {
      setWaCloudBanner("Conexão cancelada. Tente novamente.");
    } else if (wa === "no_numbers") {
      setWaCloudBanner("Nenhum número WhatsApp Business encontrado na conta Meta.");
    } else if (wa === "error") {
      setWaCloudBanner("Erro ao conectar com a Meta. Tente novamente.");
    }
  }, [searchParams, loadWaCloudStatus]);

  // ── Load agents for form → agent selector ────────────────────────────────
  useEffect(() => {
    fetch("/api/client/agentes", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { agents?: Agent[] } | null) => {
        if (d?.agents) setAgents(d.agents.map((a) => ({ id: a.id, nome: a.nome })));
      })
      .catch(() => {});
  }, []);

  const saveFormMapping = useCallback(
    async (form: MetaStatusPage["forms"][number], pageId: string) => {
      const agentId = formMappingValues[form.form_id];
      if (!agentId) return;
      setFormMappingSaving((prev) => ({ ...prev, [form.form_id]: true }));
      try {
        await fetch("/api/client/meta/form-mapping", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ form_id: form.form_id, agent_id: agentId, form_name: form.form_name, page_id: pageId }),
        });
      } finally {
        setFormMappingSaving((prev) => ({ ...prev, [form.form_id]: false }));
      }
    },
    [formMappingValues],
  );

  const disconnectMeta = useCallback(async () => {
    setMetaDisconnecting(true);
    try {
      const res = await fetch("/api/client/meta/disconnect", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to disconnect Meta");

      setMetaStatus({ connected: false, pages: [] });
      setFormMappingValues({});
      setMetaBanner(null);
      setDisconnectModalOpen(false);
      void loadMetaStatus();
      router.replace("/dashboard/integracoes");
    } catch {
      setMetaBanner("Erro ao desconectar. Tente novamente.");
    } finally {
      setMetaDisconnecting(false);
    }
  }, [loadMetaStatus, router]);

  const disconnectWaCloud = useCallback(async () => {
    setWaCloudDisconnecting(true);
    try {
      const res = await fetch("/api/client/whatsapp-cloud/disconnect", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to disconnect");
      setWaCloudStatus({ connected: false });
      setWaCloudBanner(null);
    } catch {
      setWaCloudBanner("Erro ao desconectar. Tente novamente.");
    } finally {
      setWaCloudDisconnecting(false);
    }
  }, []);

  // FB.login() must be called synchronously within the user-gesture context.
  // The SDK and config_id are pre-loaded on mount (see useEffect above) so no
  // awaits are needed before calling FB.login(), preventing popup blockers.
  const connectWaCloud = useCallback(() => {
    const cfg = waCloudConfigRef.current;
    if (!window.FB || !cfg) {
      const reason = waCloudSdkErrorRef.current;
      setWaCloudBanner(
        reason
          ? `Não foi possível carregar o SDK da Meta (${reason}). Desative bloqueadores de anúncio para este site e recarregue a página.`
          : "SDK Meta ainda carregando. Aguarde um instante e tente novamente.",
      );
      return;
    }

    setWaCloudConnecting(true);
    setWaCloudBanner(null);

    let wabaId: string | null = null;
    let phoneNumberId: string | null = null;
    let callbackFired = false;

    // Official Embedded Signup channel: the popup posts session info to the
    // opener via postMessage with type WA_EMBEDDED_SIGNUP (FINISH carries
    // waba_id + phone_number_id). FB.Event.subscribe is a legacy API and no
    // longer delivers these ids.
    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !event.origin.endsWith("facebook.com")) return;
      try {
        const data = (typeof event.data === "string" ? JSON.parse(event.data) : event.data) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string; current_step?: string };
        } | null;
        if (!data || data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
          wabaId = data.data?.waba_id ?? null;
          phoneNumberId = data.data?.phone_number_id ?? null;
        } else if (data.event === "CANCEL" || data.event === "ERROR") {
          console.warn("[wa-embedded-signup]", data.event, data.data);
        }
      } catch {
        // postMessage from unrelated facebook widgets — ignore
      }
    };

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
    };

    // Safety valve: if the FB.login callback never fires (popup blocked, SDK bug,
    // etc.) reset the loading state after 120 s so the button isn't stuck forever.
    const safetyTimer = setTimeout(() => {
      if (!callbackFired) {
        cleanup();
        setWaCloudBanner("O popup do Facebook não respondeu. Permita popups para este site e tente novamente.");
        setWaCloudConnecting(false);
      }
    }, 120_000);

    window.addEventListener("message", onMessage);

    try {
      // FB.login rejects async callbacks ("Expression is of type asyncfunction"),
      // so the callback is a plain function that starts an async IIFE.
      window.FB.login(
        (response) => {
          callbackFired = true;
          clearTimeout(safetyTimer);
          void (async () => {
            if (!response.authResponse?.code) {
              cleanup();
              setWaCloudBanner("Conexão cancelada ou não autorizada.");
              setWaCloudConnecting(false);
              return;
            }

            // The FINISH postMessage can land moments after this callback fires —
            // wait up to 3 s for the ids before concluding no number exists.
            for (let i = 0; i < 30 && (!wabaId || !phoneNumberId); i++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            cleanup();

            if (!wabaId || !phoneNumberId) {
              setWaCloudBanner("Nenhum número WhatsApp Business encontrado. Tente novamente.");
              setWaCloudConnecting(false);
              return;
            }

            try {
              const exchRes = await fetch("/api/client/whatsapp-cloud/exchange-code", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: response.authResponse.code, waba_id: wabaId, phone_number_id: phoneNumberId }),
              });
              const exchData = (await exchRes.json()) as {
                connected?: boolean;
                phone_number_id?: string;
                display_phone?: string | null;
                verified_name?: string | null;
                error?: string;
              };
              if (exchData.connected && exchData.phone_number_id) {
                setWaCloudStatus({
                  connected: true,
                  phone_number_id: exchData.phone_number_id,
                  display_phone: exchData.display_phone ?? null,
                  verified_name: exchData.verified_name ?? null,
                });
                setWaCloudBanner("✅ WhatsApp API Oficial conectado com sucesso!");
              } else {
                setWaCloudBanner("Erro ao salvar conexão. Tente novamente.");
              }
            } catch {
              setWaCloudBanner("Erro de rede ao salvar conexão. Tente novamente.");
            } finally {
              setWaCloudConnecting(false);
            }
          })();
        },
        {
          config_id: cfg.config_id,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
        },
      );
    } catch (err) {
      // FB.login() threw synchronously (e.g., invalid config, popup blocked at SDK level).
      // Surface the real SDK message so failures are diagnosable from the screen.
      clearTimeout(safetyTimer);
      cleanup();
      const msg = err instanceof Error ? err.message : String(err);
      setWaCloudBanner(`Erro ao iniciar conexão Meta: ${msg}. Tente novamente.`);
      console.error("[connectWaCloud]", msg);
      setWaCloudConnecting(false);
    }
  }, []);

  const waExtraSlots = useMemo(() => {
    void revision;
    return readExtraSlotsSummary(tenantId);
  }, [revision, tenantId]);

  const waSlots = useMemo(() => {
    void revision;
    return readWhatsAppSlotMethods(tenantId);
  }, [revision, tenantId]);

  const metaPages = metaStatus?.pages ?? [];
  const metaConnected = metaPages.length > 0;
  const visibleMetaBanner = metaBanner?.startsWith("✅") && !metaConnected ? null : metaBanner;

  const waLineStatus = useMemo(() => {
    void revision;
    return {
      waLinesReady: waSlots.filter(Boolean).length,
      waLineCount: waSlots.length,
    };
  }, [revision, waSlots]);

  return (
    <div className="space-y-8">
      {banner ? (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
            isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-500/35 bg-amber-500/10 text-amber-100",
          )}
          role="alert"
          aria-live="polite"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">{banner}</div>
          <button type="button" className="shrink-0 text-xs font-semibold underline" onClick={() => setBanner(null)}>
            Fechar
          </button>
        </div>
      ) : null}

      <section
        id="canal-whatsapp"
        className={cn(
          "overflow-hidden rounded-xl border",
          isLight ? "border-emerald-200/60 bg-surface-card" : "border-emerald-500/20 bg-surface-card/40",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6",
            isLight ? "border-emerald-100 bg-emerald-50/50" : "border-emerald-500/15 bg-emerald-500/[0.06]",
          )}
        >
          <div className="flex items-center gap-3">
            <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15", isLight ? "text-emerald-600" : "text-emerald-300")}>
              <Plug className="size-5" strokeWidth={2} aria-hidden />
            </span>
            <div>
              <p className={cn(typography.ui.overline, "text-emerald-700 dark:text-emerald-300/90")}>Canal principal</p>
              <h3 className="font-display text-lg font-bold text-content">WhatsApp Business</h3>
              <p className="text-xs text-content-secondary">
                Tem <strong className="text-content">{waSlots.length}</strong>{" "}
                {waSlots.length === 1 ? "linha" : "linhas"} (plano + extras). Em cada linha escolha <strong className="text-content">QR</strong> ou{" "}
                <strong className="text-content">API Meta</strong> — só uma opção por número.
              </p>
            </div>
          </div>
          <Badge
            className={cn(
              "mr-5 shrink-0 self-center text-[10px] sm:mr-6",
              waLineStatus.waLinesReady > 0
                ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                : "border-line bg-surface-elevated/50 text-content-secondary",
            )}
          >
            {waLineStatus.waLinesReady}/{waLineStatus.waLineCount} com metodo
          </Badge>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          {waExtraSlots.purchased > 0 ? (
            <div
              className={cn(
                "rounded-xl border p-4 text-sm ",
                isLight
                  ? "border-emerald-200 bg-emerald-50/90 text-content-secondary"
                  : "border-emerald-500/30 bg-emerald-950/25 text-content-secondary",
              )}
              role="region"
              aria-label="Linhas WhatsApp extra"
            >
              <p className="font-semibold text-content">Linhas WhatsApp extra</p>
              <p className="mt-2 text-xs leading-relaxed">
                Tem <strong className="text-content">{waExtraSlots.purchased}</strong>{" "}
                {waExtraSlots.purchased === 1 ? "linha extra contratada" : "linhas extra contratadas"} ({formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mes por linha). Cada
                numero <strong className="text-content">liga-se aqui</strong> (QR ou API da Meta); a compra so define quantas linhas — nao pede telefone no checkout.
              </p>
              {waExtraSlots.configured < waExtraSlots.purchased ? (
                <p className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-content">
                  Faltam <strong>{waExtraSlots.purchased - waExtraSlots.configured}</strong>{" "}
                  {waExtraSlots.purchased - waExtraSlots.configured === 1 ? "linha extra por ligar" : "linhas extra por ligar"} (escolha QR ou Meta em cada linha abaixo).
                </p>
              ) : (
                <p className={cn("mt-2 text-xs", isLight ? "text-emerald-700" : "text-emerald-300")}>Todas as linhas extra tem metodo definido.</p>
              )}
            </div>
          ) : null}
          <p className="text-sm text-content-secondary">
            Com <strong className="text-content">QR</strong>, o código é gerado no seu servidor WhatsApp (Evolution) e aparece aqui. Com <strong className="text-content">API Meta</strong>, o
            caminho oficial para número verificado e envios em massa. Só vê as linhas incluídas no plano.
          </p>
          <details
            className={cn(
              "rounded-lg border text-sm",
              isLight ? "border-slate-200 bg-surface-deep/50" : "border-line bg-surface-deep/20",
            )}
          >
            <summary className="cursor-pointer select-none px-3 py-2 font-medium text-content [&::-webkit-details-marker]:hidden">
              Detalhes para equipa técnica (Evolution / Meta)
            </summary>
            <p className="border-t border-line/60 px-3 py-2 text-xs leading-relaxed text-content-muted">
              O QR liga à Evolution na VPS: o MyChatCRM cria a instância e mostra o código. A API Meta é a opção certa para empresas com templates aprovados.
            </p>
          </details>
          <div className="space-y-5">
            {waSlots.map((method, slotIndex) => {
              const isBase = slotIndex === 0;
              const lineTitle = isBase ? `Linha ${slotIndex + 1} — numero incluido no plano` : `Linha ${slotIndex + 1} — numero extra`;
              return (
                <div
                  key={slotIndex}
                  className={cn(
                    "rounded-xl border p-4 sm:p-5",
                    isLight ? "border-emerald-200/80 bg-surface-deep/90" : "border-emerald-500/20 bg-surface-deep/25",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/60 pb-3">
                    <div>
                      <p className="text-sm font-semibold text-content">{lineTitle}</p>
                      <p className="mt-0.5 text-[11px] text-content-muted">Um metodo por linha. Trocar desliga esta linha para escolher de novo.</p>
                    </div>
                    <Badge
                      className={cn(
                        "shrink-0 text-[10px]",
                        method === "qr"
                          ? "border-info/35 bg-info/10 text-info"
                          : method === "meta"
                            ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                            : "border-line bg-surface-elevated/50 text-content-secondary",
                      )}
                    >
                      {method === "qr" ? "QR Code" : method === "meta" ? "API Meta" : "Nao ligada"}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-4">
                    {!method ? (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-content">Passo 1 — Como quer ligar este número?</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setWhatsAppSlotMethod(tenantId, slotIndex, "qr")}
                            className={cn(
                              "flex min-h-[44px] flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
                              "border-line bg-surface-elevated/40 hover:border-line/80 hover:bg-surface-elevated/60",
                            )}
                          >
                            <span className="flex items-center gap-2 font-semibold text-content">
                              <QrCode className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                              QR Code (telemóvel)
                            </span>
                            <span className="text-xs leading-relaxed text-content-muted">Ideal para testar rápido. Um número por sessão nesta linha.</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setWhatsAppSlotMethod(tenantId, slotIndex, "meta")}
                            className={cn(
                              "flex min-h-[44px] flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
                              "border-line bg-surface-elevated/40 hover:border-line/80 hover:bg-surface-elevated/60",
                            )}
                          >
                            <span className="flex items-center gap-2 font-semibold text-content">
                              <BadgeCheck className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                              API Meta (empresa)
                            </span>
                            <span className="text-xs leading-relaxed text-content-muted">Número verificado e envios oficiais (configuração avançada).</span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {method === "qr" ? (
                      <div className="space-y-4">
                        <EvolutionQrSlotPanel
                          key={`evo-qr-${tenantId}-${slotIndex}`}
                          slotIndex={slotIndex}
                          autoProvision={false}
                        />
                        <div className="flex flex-wrap items-center gap-3 border-t border-line/40 pt-3">
                          <p className="flex-1 text-[11px] text-content-muted">
                            Para trocar de método ou desligar permanentemente esta linha:
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            className="shrink-0 border-rose-500/30 text-rose-600 hover:border-rose-500/50 hover:bg-rose-500/5 dark:text-rose-400"
                            onClick={async () => {
                              try {
                                await fetch(`/api/client/whatsapp/evolution/session?slotIndex=${slotIndex}`, {
                                  method: "DELETE",
                                  credentials: "same-origin",
                                });
                              } catch {
                                /* ignore */
                              }
                              setWhatsAppSlotMethod(tenantId, slotIndex, null);
                            }}
                          >
                            Desligar esta linha
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {method === "meta" ? (
                      <div className="space-y-4">
                        {waCloudBanner ? (
                          <div
                            className={cn(
                              "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
                              waCloudBanner.startsWith("✅")
                                ? isLight
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : isLight
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-amber-500/30 bg-amber-500/10 text-amber-300",
                            )}
                          >
                            <span className="mt-0.5 shrink-0">
                              {waCloudBanner.startsWith("✅") ? <BadgeCheck className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
                            </span>
                            <p>{waCloudBanner}</p>
                          </div>
                        ) : null}

                        {waCloudLoading ? (
                          <div className="flex items-center gap-2 text-sm text-content-muted">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            A verificar conexão…
                          </div>
                        ) : waCloudStatus?.connected ? (
                          <div className="space-y-3">
                            <div
                              className={cn(
                                "flex items-center gap-3 rounded-xl border p-4",
                                isLight ? "border-emerald-200 bg-emerald-50/60" : "border-emerald-500/25 bg-emerald-500/[0.07]",
                              )}
                            >
                              <BadgeCheck className={cn("size-5 shrink-0", isLight ? "text-emerald-600" : "text-emerald-400")} aria-hidden />
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-content">{waCloudStatus.display_phone ?? waCloudStatus.phone_number_id}</p>
                                {waCloudStatus.verified_name ? (
                                  <p className="text-xs text-content-secondary">{waCloudStatus.verified_name}</p>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="shrink-0 border-rose-500/30 text-rose-600 hover:border-rose-500/50 hover:bg-rose-500/5 dark:text-rose-400"
                                isLoading={waCloudDisconnecting}
                                onClick={disconnectWaCloud}
                              >
                                <Unlink className="size-4" aria-hidden />
                                Desconectar API Oficial
                              </Button>
                              <Button type="button" variant="outline" onClick={() => setWhatsAppSlotMethod(tenantId, slotIndex, null)}>
                                Desligar esta linha
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-sm text-content-secondary">
                              Conecte sua conta <strong className="text-content">WhatsApp Business</strong> via Meta API Oficial. O processo é guiado pela própria Meta — sem copiar
                              chaves ou configurações manuais.
                            </p>
                            <ul className="space-y-1 text-xs text-content-muted">
                              <li className="flex items-center gap-1.5">
                                <BadgeCheck className="size-3 shrink-0 text-primary" aria-hidden />
                                Número verificado e suportado pela Meta
                              </li>
                              <li className="flex items-center gap-1.5">
                                <BadgeCheck className="size-3 shrink-0 text-primary" aria-hidden />
                                Envios em escala com templates aprovados
                              </li>
                              <li className="flex items-center gap-1.5">
                                <BadgeCheck className="size-3 shrink-0 text-primary" aria-hidden />
                                Sem necessidade de aparelho ligado
                              </li>
                            </ul>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                isLoading={waCloudConnecting}
                                onClick={connectWaCloud}
                                className="min-h-[44px] gap-2 bg-primary px-5 text-white hover:bg-primary-hover"
                              >
                                {!waCloudConnecting && <ExternalLink className="size-4" aria-hidden />}
                                Conectar WhatsApp API Oficial
                              </Button>
                              <Button type="button" variant="outline" onClick={() => setWhatsAppSlotMethod(tenantId, slotIndex, null)}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="canal-facebook"
        className={cn(
          "overflow-hidden rounded-xl border",
          isLight ? "border-blue-200/70 bg-surface-card" : "border-blue-500/25 bg-surface-card/40",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6",
            isLight ? "border-blue-100 bg-blue-50/50" : "border-blue-500/15 bg-blue-500/[0.06]",
          )}
        >
          <div className="flex items-center gap-3">
            <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/15", isLight ? "text-blue-600" : "text-blue-300")}>
              <Share2 className="size-5" strokeWidth={2} aria-hidden />
            </span>
            <div>
              <p className={cn(typography.ui.overline, "text-blue-700 dark:text-blue-300/90")}>Meta Lead Ads</p>
              <h3 className="font-display text-lg font-bold text-content">Páginas Facebook · Lead Ads</h3>
              <p className="text-xs text-content-secondary">Leads dos formulários Meta entram direto no CRM e recebem mensagem automática no WhatsApp.</p>
            </div>
          </div>
          <Badge
            className={cn(
              "shrink-0 text-[10px]",
              metaConnected
                ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                : "border-line bg-surface-elevated/50 text-content-secondary",
            )}
          >
            {metaLoading ? "..." : metaConnected ? "Conectado" : "Não conectado"}
          </Badge>
        </div>

        {/* Body */}
        <div className="space-y-5 p-5 sm:p-6">
          {/* Meta OAuth banner */}
          {visibleMetaBanner ? (
            <div
              className={cn(
                "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
                visibleMetaBanner.startsWith("✅")
                  ? isLight
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : isLight
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300",
              )}
            >
              <span className="mt-0.5 shrink-0">
                {visibleMetaBanner.startsWith("✅") ? <BadgeCheck className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
              </span>
              <p>{visibleMetaBanner}</p>
            </div>
          ) : null}

          {metaLoading ? (
            <div className="flex items-center gap-2 text-sm text-content-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              A verificar ligação Meta…
            </div>
          ) : metaConnected ? (
            /* Connected state: show pages + form→agent mappings */
            <div className="space-y-4">
              {metaPages.map((page) => (
                <details key={page.page_id} className={cn("rounded-lg border", isLight ? "border-blue-100 bg-blue-50/30" : "border-blue-500/15 bg-blue-500/[0.05]")}>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2 text-sm font-semibold text-content">
                      <BadgeCheck className={cn("size-4 shrink-0", isLight ? "text-emerald-600" : "text-emerald-400")} aria-hidden />
                      {page.page_name ?? page.page_id}
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-content-muted transition-transform [[open]_summary_&]:rotate-180" aria-hidden />
                  </summary>
                  <div className="border-t border-line/30 px-4 py-3">
                    <p className="mb-3 text-xs text-content-secondary">
                      ID da página: <code className="rounded bg-surface-elevated/60 px-1">{page.page_id}</code>
                    </p>
                    {page.forms.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs font-medium text-content-secondary">Formulários detectados — escolha o agente para cada um:</p>
                        {page.forms.map((form) => (
                          <div key={form.form_id} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs text-content" title={form.form_name ?? form.form_id}>
                              {form.form_name ?? form.form_id}
                            </span>
                            <select
                              value={formMappingValues[form.form_id] ?? ""}
                              onChange={(e) => setFormMappingValues((prev) => ({ ...prev, [form.form_id]: e.target.value }))}
                              className="rounded-md border border-line bg-surface-elevated px-2 py-1 text-xs text-content focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">— Agente padrão —</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.nome}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => saveFormMapping(form, page.page_id)}
                              isLoading={formMappingSaving[form.form_id]}
                              disabled={!formMappingValues[form.form_id] || formMappingSaving[form.form_id]}
                            >
                              <Check className="size-3" aria-hidden />
                              Salvar
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-content-muted">
                        Nenhum formulário mapeado ainda. Os leads chegarão com o agente padrão do tenant até que forms sejam detectados.
                      </p>
                    )}
                  </div>
                </details>
              ))}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setDisconnectModalOpen(true)}
                >
                  <Unlink className="size-4" aria-hidden />
                  Desconectar Meta
                </Button>
              </div>
            </div>
          ) : (
            /* Disconnected state */
            <div className="space-y-4">
              <p className="text-sm text-content-secondary">
                Conecte suas <strong className="text-content">páginas Facebook</strong> via OAuth para que leads dos formulários{" "}
                <strong className="text-content">Lead Ads</strong> entrem automaticamente no CRM e recebam mensagem no WhatsApp.
              </p>
              <ul className="space-y-1 text-xs text-content-muted">
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Todas as suas páginas do Facebook conectadas automaticamente</li>
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Formulários de Lead Ads mapeados por página</li>
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Leads entram no CRM Kanban em tempo real</li>
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Agente de IA responde o lead no WhatsApp na hora</li>
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Roteamento por formulário — cada formulário pode ter um agente diferente</li>
              </ul>
              <a href="/api/meta/connect" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
                <ExternalLink className="size-4" aria-hidden />
                Conectar com Meta
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Disconnect confirmation modal */}
      {disconnectModalOpen ? (
        <Modal
          open={true}
          onClose={() => setDisconnectModalOpen(false)}
          title="Desconectar Meta"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDisconnectModalOpen(false)} disabled={metaDisconnecting}>
                Cancelar
              </Button>
              <Button type="button" variant="outline" onClick={disconnectMeta} isLoading={metaDisconnecting}>
                <Unlink className="size-4" aria-hidden />
                Desconectar
              </Button>
            </div>
          }
        >
          <p className="text-sm text-content-secondary">
            Isso removerá todas as páginas Facebook conectadas e os mapeamentos de formulários. Os leads já criados no CRM não serão afetados.
          </p>
        </Modal>
      ) : null}

    </div>
  );
}
