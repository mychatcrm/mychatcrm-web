"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Check, Plug, QrCode, Share2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
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
import {
  facebookPagesStorageKey,
  FACEBOOK_PAGES_CONNECTION_UPDATED_EVENT,
  loadFacebookPagesConnection,
  persistFacebookPagesConnection,
  type FacebookPagesConnectionState,
} from "@/lib/facebook-pages-connection-storage";
import { typography } from "@/lib/typography";
import { EvolutionQrSlotPanel } from "@/components/dashboard/integrations/EvolutionQrSlotPanel";

const MAX_HINT = 120;

function safeRun<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Anel de progresso simples (SVG) — “X de Y” ligacoes prontas, incluindo WhatsApp quando escolhido. */
function IntegrationsHealthRing({
  active,
  total,
  caption,
  gradId,
}: {
  active: number;
  total: number;
  caption: string;
  gradId: string;
}) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(1, Math.max(0, active / safeTotal));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = pct * circumference;
  const label = `${active} de ${total} ligacoes ativas no painel`;

  return (
    <div className="flex flex-col items-center justify-center py-2" role="img" aria-label={label}>
      <div className="relative h-[168px] w-[168px]">
        <svg width="168" height="168" viewBox="0 0 168 168" className="text-content/5" aria-hidden>
          <g transform="translate(84,84) rotate(-90)">
            <circle r={radius} fill="none" stroke="currentColor" strokeWidth="12" className="text-line/40" />
            <circle
              r={radius}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="transition-[stroke-dasharray] duration-700 ease-out"
            />
          </g>
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(20,38,58)" />
              <stop offset="55%" stopColor="rgb(242,68,0)" />
              <stop offset="100%" stopColor="rgb(178,42,0)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-bold tabular-nums leading-none text-content">{active}</span>
          <span className="mt-1 text-[11px] font-medium text-content-muted">de {total}</span>
          <span className="mt-2 max-w-[7.5rem] text-[10px] leading-snug text-content-faint">{caption}</span>
        </div>
      </div>
    </div>
  );
}

export function IntegracoesHub({ tenantId }: { tenantId: string }) {
  const ringGradId = useId().replace(/:/g, "");
  const { isLight } = usePanelAppearance();
  const [revision, setRevision] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [fbModalOpen, setFbModalOpen] = useState(false);
  const [fbHint, setFbHint] = useState("");
  const [fbConnected, setFbConnected] = useState(false);
  const [fbSaving, setFbSaving] = useState(false);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const prefetchEvolutionSessionForSlot = useCallback(async (slotIndex: number) => {
    try {
      await fetch("/api/client/whatsapp/evolution/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex }),
      });
    } catch {
      /* ignorar — EvolutionQrSlotPanel faz GET/POST de seguida */
    }
  }, []);

  useEffect(() => {
    bump();
  }, [bump, tenantId]);

  useEffect(() => {
    const onWa = () => bump();
    const onFb = () => bump();
    window.addEventListener(WHATSAPP_CONNECTION_UPDATED_EVENT, onWa);
    window.addEventListener(FACEBOOK_PAGES_CONNECTION_UPDATED_EVENT, onFb);
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (whatsappConnectionWatchableStorageKeys(tenantId).includes(e.key)) onWa();
      if (e.key === facebookPagesStorageKey(tenantId)) bump();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(WHATSAPP_CONNECTION_UPDATED_EVENT, onWa);
      window.removeEventListener(FACEBOOK_PAGES_CONNECTION_UPDATED_EVENT, onFb);
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
        e.key === facebookPagesStorageKey(tenantId) ||
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

  const facebookState = useMemo(() => {
    void revision;
    return safeRun(() => loadFacebookPagesConnection(tenantId), { connected: false } satisfies FacebookPagesConnectionState);
  }, [revision, tenantId]);

  const waExtraSlots = useMemo(() => {
    void revision;
    return readExtraSlotsSummary(tenantId);
  }, [revision, tenantId]);

  const waSlots = useMemo(() => {
    void revision;
    return readWhatsAppSlotMethods(tenantId);
  }, [revision, tenantId]);

  const openFbModal = useCallback(() => {
    setBanner(null);
    const st = safeRun(() => loadFacebookPagesConnection(tenantId), { connected: false });
    setFbConnected(st.connected);
    setFbHint(st.accountHint ?? "");
    setFbModalOpen(true);
  }, [tenantId]);

  const closeFbModal = useCallback(() => {
    setFbModalOpen(false);
    setFbHint("");
    setFbSaving(false);
  }, []);

  const saveFbModal = useCallback(() => {
    const trimmed = fbHint.trim().slice(0, MAX_HINT);
    if (fbHint.length > MAX_HINT) {
      setBanner(`Use no maximo ${MAX_HINT} caracteres na descricao da conta.`);
      return;
    }
    setFbSaving(true);
    setBanner(null);
    try {
      persistFacebookPagesConnection(tenantId, {
        connected: fbConnected,
        accountHint: fbConnected ? trimmed || undefined : undefined,
      });
      bump();
      closeFbModal();
    } catch {
      setBanner("Nao foi possivel guardar. Verifique o armazenamento do navegador ou tente de novo.");
    } finally {
      setFbSaving(false);
    }
  }, [bump, closeFbModal, fbConnected, fbHint, tenantId]);

  const quickDisconnectFacebook = useCallback(() => {
    setBanner(null);
    try {
      persistFacebookPagesConnection(tenantId, { connected: false, accountHint: undefined });
      bump();
    } catch {
      setBanner("Falha ao desligar a integracao.");
    }
  }, [bump, tenantId]);

  const health = useMemo(() => {
    void revision;
    const waLinesReady = waSlots.filter(Boolean).length;
    const waOn = waLinesReady > 0;
    const fbOn = Boolean(facebookState.connected);
    const channelTotal = 2;
    const channelActive = (waOn ? 1 : 0) + (fbOn ? 1 : 0);
    return {
      donutActive: channelActive,
      donutTotal: channelTotal,
      waLinesReady,
      waLineCount: waSlots.length,
    };
  }, [facebookState.connected, revision, waSlots]);

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
              health.waLinesReady > 0
                ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                : "border-line bg-surface-elevated/50 text-content-secondary",
            )}
          >
            {health.waLinesReady}/{health.waLineCount} com metodo
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
                          ? cn("border-sky-500/40 bg-sky-500/15", isLight ? "text-sky-800" : "text-sky-200")
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
                            onClick={async () => {
                              await prefetchEvolutionSessionForSlot(slotIndex);
                              setWhatsAppSlotMethod(tenantId, slotIndex, "qr");
                            }}
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
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-content">Passo 2 — Confirme o código no telemóvel</p>
                        <EvolutionQrSlotPanel key={`evo-qr-${tenantId}-${slotIndex}`} slotIndex={slotIndex} />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
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
                      <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
                        <p className={typography.ui.overline}>Fluxo API Meta (demo) — linha {slotIndex + 1}</p>
                        <p>
                          Aqui entraria o assistente ao Business Manager, verificacao do numero e System User — neste ambiente e apenas simulacao; nunca cole chaves de API reais no
                          browser.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input readOnly defaultValue="waba_••••••••••••••••" placeholder="ID do WABA" aria-label="ID do WABA (demo)" />
                          <Input readOnly type="password" defaultValue="EAAG••••••••••••••" placeholder="Chave de acesso" aria-label="Chave de acesso (demo)" />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button">Validar credenciais</Button>
                          <Button type="button" variant="secondary">
                            Abrir documentacao Meta
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setWhatsAppSlotMethod(tenantId, slotIndex, null)}>
                            Desligar esta linha
                          </Button>
                        </div>
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
              <p className={cn(typography.ui.overline, "text-blue-700 dark:text-blue-300/90")}>Outro canal</p>
              <h3 className="font-display text-lg font-bold text-content">Páginas Facebook da empresa</h3>
              <p className="text-xs text-content-secondary">Ligue páginas Meta para campanhas e mensagens. Nesta versão de demonstração o estado fica no navegador.</p>
            </div>
          </div>
          <Badge
            className={cn(
              "shrink-0 text-[10px]",
              facebookState.connected
                ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                : "border-line bg-surface-elevated/50 text-content-secondary",
            )}
          >
            {facebookState.connected ? "Ligado" : "Nao ligado"}
          </Badge>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <p className="text-sm text-content-secondary">
            Indique se as <strong className="text-content">páginas Facebook</strong> da empresa estão associadas ao MyChatCRM. A ligação completa com a Meta (OAuth) virá numa
            próxima versão.
          </p>
          {facebookState.accountHint ? (
            <p className="truncate text-xs text-content-secondary" title={facebookState.accountHint}>
              Conta ou página: <span className="font-medium text-content">{facebookState.accountHint}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={facebookState.connected ? "secondary" : "gradient"} size="sm" className="min-h-[44px]" onClick={openFbModal}>
              {facebookState.connected ? "Ajustar ligacao" : "Ligar agora"}
            </Button>
            {facebookState.connected ? (
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={quickDisconnectFacebook}>
                Desligar
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <details
        className={cn(
          "overflow-hidden rounded-xl border [&_summary::-webkit-details-marker]:hidden",
          isLight
            ? "border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-primary/[0.06]"
            : "border-line bg-gradient-to-br from-surface-card via-surface-deep/50 to-primary/[0.07]",
        )}
      >
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-content sm:px-7 sm:py-5">
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            Guia rápido e resumo das ligações
          </span>
        </summary>
        <div className="border-t border-line/40 px-5 pb-6 pt-2 sm:px-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_min(100%,260px)] lg:items-center">
            <div>
              <h2 className={cn(typography.heading.h3, "text-content")}>Três ideias simples</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-content-secondary">
                Use os botões <span className="font-medium text-content">Ligar agora</span> ou <span className="font-medium text-content">QR / Meta</span> nos canais acima — sem
                comandos.
              </p>
              <ol className="mt-5 space-y-3 text-sm text-content-secondary">
                <li className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">1</span>
                  <div>
                    <p className="font-medium text-content">Escolha o canal</p>
                    <p className="text-xs text-content-muted">WhatsApp em primeiro lugar; Facebook quando fizer sentido para a empresa.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">2</span>
                  <div>
                    <p className="font-medium text-content">Ligue com um clique</p>
                    <p className="text-xs text-content-muted">Nome da conta opcional e interruptor para ativar.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">3</span>
                  <div>
                    <p className="font-medium text-content">Use no dia a dia</p>
                    <p className="text-xs text-content-muted">Quando o backend estiver ativo, dados sincronizam com CRM, agenda e lembretes.</p>
                  </div>
                </li>
              </ol>
            </div>
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border p-4",
                isLight ? "border-slate-200/80 bg-surface-deep/80" : "border-line/80 bg-surface-deep/35",
              )}
            >
              <div className="mb-0.5 flex items-center justify-center gap-1.5">
                <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                <p className={cn(typography.ui.overline, "text-primary")}>Resumo</p>
              </div>
              <IntegrationsHealthRing
                gradId={ringGradId}
                active={health.donutActive}
                total={health.donutTotal}
                caption="WhatsApp + Facebook"
              />
              <p className="mt-1 text-center text-[11px] text-content-muted">
                WhatsApp {health.waLinesReady}/{health.waLineCount} linha(s) com método · Facebook {facebookState.connected ? "ligado" : "nao ligado"}
              </p>
            </div>
          </div>
        </div>
      </details>

      <details
        className={cn(
          "rounded-xl border text-sm",
          isLight ? "border-primary/20 bg-primary/[0.06] text-content" : "border-primary/25 bg-primary/[0.08] text-content",
        )}
      >
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-content sm:px-5 [&::-webkit-details-marker]:hidden">
          Nota sobre esta demonstração
        </summary>
        <div className="space-y-3 border-t border-line/30 px-4 py-3 text-content-secondary sm:px-5">
          <p>
            <strong className="text-content">Google Agenda</strong> e outras ligações futuras usam a mesma área de{" "}
            <Link href="/dashboard/agenda" className="font-semibold text-primary underline-offset-2 hover:underline">
              Agenda
            </Link>{" "}
            e restantes menus do painel quando estiverem disponíveis. Nesta página focamo-nos em WhatsApp e Facebook.
          </p>
          <details className="rounded-lg border border-line/50 bg-surface-deep/20">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-content [&::-webkit-details-marker]:hidden">
              Para equipa técnica
            </summary>
            <p className="border-t border-line/40 px-3 py-2 text-xs leading-relaxed text-content-muted">
              O WhatsApp por QR (Evolution) usa sessão e webhook nas rotas do servidor e base de dados; a escolha QR/Meta por linha sincroniza neste navegador. A integração Meta
              oficial segue em preparação.
            </p>
          </details>
        </div>
      </details>

      {fbModalOpen ? (
        <Modal
          open={true}
          onClose={closeFbModal}
          title="Páginas Facebook da empresa"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeFbModal} disabled={fbSaving}>
                Cancelar
              </Button>
              <Button type="button" variant="gradient" onClick={saveFbModal} isLoading={fbSaving}>
                <Check className="size-4" aria-hidden />
                Guardar
              </Button>
            </div>
          }
        >
          <p className="text-sm text-content-secondary">
            Indique se as páginas da empresa estão ligadas e, opcionalmente, o nome da página ou da conta comercial.
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-content-secondary" htmlFor="fb-hint">
                Nome da página ou nota (opcional, ate {MAX_HINT} caracteres)
              </label>
              <Input
                id="fb-hint"
                value={fbHint}
                onChange={(e) => setFbHint(e.target.value.slice(0, MAX_HINT))}
                placeholder="Ex.: Pagina Minha Empresa PT"
                className="mt-1"
                maxLength={MAX_HINT}
              />
            </div>
            <Toggle id="fb-connected" checked={fbConnected} onChange={setFbConnected} label="Ligacao ativa" />
            <p className="text-[11px] text-content-secondary">
              O mesmo estado aparece em <strong className="text-content">Integrações de Leads</strong> na aba Canais.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
