"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Check, ChevronRight, ExternalLink, Plug, QrCode, Share2, Sparkles } from "lucide-react";
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
  GOOGLE_AGENDA_LS_KEY,
  GOOGLE_AGENDA_UPDATED_EVENT,
  loadGoogleAgendaState,
  persistGoogleAgendaState,
  type GoogleAgendaLinkState,
} from "@/components/dashboard/agenda/agenda-storage";
import type { IntegrationDefinition, IntegrationSlug } from "@/lib/integrations-catalog";
import { integrationsGrouped } from "@/lib/integrations-catalog";
import {
  clientIntegrationsStorageKey,
  INTEGRATIONS_CLIENT_UPDATED_EVENT,
  loadClientIntegrations,
  patchClientIntegration,
} from "@/lib/integrations-client-storage";
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
  const [modalSlug, setModalSlug] = useState<IntegrationSlug | null>(null);
  const [modalHint, setModalHint] = useState("");
  const [modalConnected, setModalConnected] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [fbModalOpen, setFbModalOpen] = useState(false);
  const [fbHint, setFbHint] = useState("");
  const [fbConnected, setFbConnected] = useState(false);
  const [fbSaving, setFbSaving] = useState(false);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

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
    const onGoogle = () => bump();
    const onClient = () => bump();
    window.addEventListener(GOOGLE_AGENDA_UPDATED_EVENT, onGoogle);
    window.addEventListener(INTEGRATIONS_CLIENT_UPDATED_EVENT, onClient);
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === GOOGLE_AGENDA_LS_KEY ||
        e.key === clientIntegrationsStorageKey(tenantId) ||
        e.key === facebookPagesStorageKey(tenantId) ||
        e.key === whatsappExtraSlotsStorageKey(tenantId) ||
        whatsappConnectionWatchableStorageKeys(tenantId).includes(e.key)
      ) {
        bump();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(GOOGLE_AGENDA_UPDATED_EVENT, onGoogle);
      window.removeEventListener(INTEGRATIONS_CLIENT_UPDATED_EVENT, onClient);
      window.removeEventListener("storage", onStorage);
    };
  }, [bump, tenantId]);

  const googleState = useMemo(() => {
    void revision;
    void tenantId;
    return safeRun(() => loadGoogleAgendaState(), { connected: false } satisfies GoogleAgendaLinkState);
  }, [revision, tenantId]);

  const clientStore = useMemo(() => {
    void revision;
    return safeRun(() => loadClientIntegrations(tenantId), { v: 1, bySlug: {} });
  }, [revision, tenantId]);

  const groups = useMemo(() => integrationsGrouped(), []);

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

  const openModal = useCallback(
    (def: IntegrationDefinition) => {
      setBanner(null);
      setModalSlug(def.slug);
      if (def.backend === "google_agenda") {
        const g = safeRun(() => loadGoogleAgendaState(), { connected: false });
        setModalConnected(g.connected);
        setModalHint(g.accountLabel ?? "");
        return;
      }
      const row = safeRun(() => loadClientIntegrations(tenantId).bySlug[def.slug], undefined);
      setModalConnected(row?.connected ?? false);
      setModalHint(row?.accountHint ?? "");
    },
    [tenantId],
  );

  const closeModal = useCallback(() => {
    setModalSlug(null);
    setModalHint("");
    setModalSaving(false);
  }, []);

  const activeDef = useMemo(
    () => (modalSlug ? groups.flatMap((g) => g.items).find((d) => d.slug === modalSlug) ?? null : null),
    [groups, modalSlug],
  );

  const saveModal = useCallback(() => {
    if (!activeDef || !modalSlug) return;
    const trimmed = modalHint.trim().slice(0, MAX_HINT);
    if (modalHint.length > MAX_HINT) {
      setBanner(`Use no maximo ${MAX_HINT} caracteres na descricao da conta.`);
      return;
    }
    setModalSaving(true);
    setBanner(null);
    try {
      if (activeDef.backend === "google_agenda") {
        const next: GoogleAgendaLinkState = {
          connected: modalConnected,
          accountLabel: modalConnected ? trimmed || "Conta Google" : undefined,
          lastSyncISO: modalConnected ? new Date().toISOString() : undefined,
        };
        persistGoogleAgendaState(next);
      } else {
        patchClientIntegration(tenantId, modalSlug, {
          connected: modalConnected,
          accountHint: trimmed || undefined,
        });
      }
      bump();
      closeModal();
    } catch {
      setBanner("Nao foi possivel guardar. Verifique o armazenamento do navegador ou tente de novo.");
    } finally {
      setModalSaving(false);
    }
  }, [activeDef, bump, closeModal, modalConnected, modalHint, modalSlug, tenantId]);

  const quickDisconnect = useCallback(
    (def: IntegrationDefinition) => {
      setBanner(null);
      try {
        if (def.backend === "google_agenda") {
          persistGoogleAgendaState({ connected: false });
        } else {
          patchClientIntegration(tenantId, def.slug, { connected: false, accountHint: "" });
        }
        bump();
      } catch {
        setBanner("Falha ao desligar a integracao.");
      }
    },
    [bump, tenantId],
  );

  const statusFor = useCallback(
    (def: IntegrationDefinition): { connected: boolean; hint?: string } => {
      if (def.backend === "google_agenda") {
        return { connected: googleState.connected, hint: googleState.accountLabel };
      }
      const row = clientStore.bySlug[def.slug];
      return { connected: Boolean(row?.connected), hint: row?.accountHint };
    },
    [clientStore.bySlug, googleState.accountLabel, googleState.connected],
  );

  const health = useMemo(() => {
    void revision;
    const items = groups.flatMap((g) => g.items);
    let catalogConnected = 0;
    for (const def of items) {
      if (statusFor(def).connected) catalogConnected++;
    }
    const waLinesReady = waSlots.filter(Boolean).length;
    const waOn = waLinesReady > 0;
    const fbOn = Boolean(facebookState.connected);
    return {
      donutActive: catalogConnected + (waOn ? 1 : 0) + (fbOn ? 1 : 0),
      donutTotal: items.length + 2,
      catalogConnected,
      catalogTotal: items.length,
      waLinesReady,
      waLineCount: waSlots.length,
    };
  }, [facebookState.connected, groups, revision, statusFor, waSlots]);

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
        className={cn(
          "overflow-hidden rounded-xl border",
          isLight
            ? "border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-primary/[0.06]"
            : "border-line bg-gradient-to-br from-surface-card via-surface-deep/50 to-primary/[0.07]",
        )}
      >
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_min(100%,280px)] lg:items-center">
          <div>
            <div className={cn("inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-primary", typography.ui.overline)}>
              <Sparkles className="size-3.5" aria-hidden />
              Guia rapido
            </div>
            <h2 className={cn("mt-3", typography.heading.h3)}>
              Integre as suas ferramentas sem ser tecnico
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-content-secondary">
              Cada cartao abaixo e um app que pode conversar com o MyChatCRM. Escolha, toque em <span className="font-medium text-content">Ligar agora</span> e siga o
              mini assistente — nada de codigo nem linha de comandos.
            </p>
            <ol className="mt-5 space-y-3 text-sm text-content-secondary">
              <li className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">1</span>
                <div>
                  <p className="font-medium text-content">Escolha o que precisa</p>
                  <p className="text-xs text-content-muted">CRM Kanban, e-mail, automacao ou o WhatsApp aqui em cima.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">2</span>
                <div>
                  <p className="font-medium text-content">Ligue com um clique</p>
                  <p className="text-xs text-content-muted">Confirme o nome da conta (opcional) e ative o interruptor.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-bold text-primary">3</span>
                <div>
                  <p className="font-medium text-content">Use no dia a dia</p>
                  <p className="text-xs text-content-muted">Dados sincronizam com CRM Kanban, agenda e lembretes quando o backend estiver ligado.</p>
                </div>
              </li>
            </ol>
          </div>
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border p-5",
              isLight ? "border-slate-200/80 bg-surface-deep/80" : "border-line/80 bg-surface-deep/35",
            )}
          >
            <div className="mb-0.5 flex items-center justify-center gap-1.5">
              <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              <p className={cn(typography.ui.overline, "text-primary")}>Visao geral</p>
            </div>
            <IntegrationsHealthRing
              gradId={ringGradId}
              active={health.donutActive}
              total={health.donutTotal}
              caption="Apps + Facebook + WhatsApp"
            />
            <p className="mt-1 text-center text-[11px] text-content-muted">
              {health.catalogConnected} apps na lista · Facebook {facebookState.connected ? "ligado" : "nao ligado"} · WhatsApp{" "}
              {health.waLinesReady}/{health.waLineCount} linha(s) com metodo (QR ou Meta)
            </p>
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
              <h3 className="font-display text-lg font-bold text-content">Páginas Facebook da empresa</h3>
              <p className="text-xs text-content-secondary">Ligação às páginas Meta da empresa — leads e mensagens (demo local).</p>
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
            Conecte as <strong className="text-content">páginas Facebook</strong> da empresa para alinhar campanhas e formulários com o MyChatCRM. Neste ambiente o
            estado fica no navegador até existir OAuth com a Meta.
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
              <h3 className="font-display text-lg font-bold text-content">WhatsApp Business</h3>
              <p className="text-xs text-content-secondary">
                {waSlots.length} linha(s) contratada(s) (1 do plano + {waExtraSlots.purchased} extra). Por linha: <strong className="text-content">QR</strong> ou{" "}
                <strong className="text-content">API Meta</strong> — uma opcao por numero, nunca as duas na mesma linha.
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
            <strong className="text-content">QR Code</strong> e ideal para testar rapido no telemovel. <strong className="text-content">API oficial da Meta</strong> e o caminho certo para
            empresas com numero verificado e templates aprovados. So aparecem as linhas que o seu plano cobre — nao e possivel ligar mais numeros sem contratar.
          </p>
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
                            Usar QR Code nesta linha
                          </span>
                          <span className="text-xs leading-relaxed text-content-muted">Um numero por sessao QR nesta linha contratada.</span>
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
                            Usar API Meta nesta linha
                          </span>
                          <span className="text-xs leading-relaxed text-content-muted">Cloud API / WABA nesta linha contratada.</span>
                        </button>
                      </div>
                    ) : null}
                    {method === "qr" ? (
                      <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
                        <p className={typography.ui.overline}>Fluxo QR Code (demo) — linha {slotIndex + 1}</p>
                        <p>
                          Numero de exemplo: <span className="font-medium text-content">+55 62 99999-{String(1000 + slotIndex).slice(-4)}</span>
                        </p>
                        <p>Status simulado: conectado e a receber mensagens.</p>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="secondary">
                            Gerar novo QR
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setWhatsAppSlotMethod(tenantId, slotIndex, null)}>
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

      <div
        className={cn(
          "rounded-xl border p-4 text-sm sm:rounded-xl sm:p-5",
          isLight ? "border-primary/20 bg-primary/[0.06] text-content" : "border-primary/25 bg-primary/[0.08] text-content",
        )}
      >
        <p className="font-medium text-content">Sobre este ecra (modo demonstracao)</p>
        <p className="mt-2 text-content-secondary">
          <strong className="text-content">Google Agenda</strong> partilha o mesmo estado da pagina{" "}
          <Link href="/dashboard/agenda" className="font-semibold text-primary underline-offset-2 hover:underline">
            Agenda
          </Link>
          . As outras integracoes e as ligacoes WhatsApp por linha (QR ou Meta) guardam preferencias neste navegador ate existir OAuth e API no servidor.
        </p>
      </div>

      {groups.map(({ group, items }) => (
        <section key={group}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">{group}</h3>
            <p className="text-[11px] text-content-faint">Toque em Ligar agora para ver o passo a passo</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((def) => {
              const st = statusFor(def);
              return (
                <div
                  key={def.slug}
                  className={cn(
                    "flex flex-col rounded-xl border p-4",
                    isLight ? "border-slate-200/90 bg-surface-deep" : "border-line bg-surface-card/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-content">{def.title}</p>
                    <Badge
                      className={cn(
                        "shrink-0 text-[10px]",
                        st.connected
                          ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                          : "border-line bg-surface-elevated/50 text-content-secondary",
                      )}
                    >
                      {st.connected ? "Ligado" : "Nao ligado"}
                    </Badge>
                  </div>
                  <p className="mt-2 flex-1 text-xs leading-relaxed text-content-secondary">{def.description}</p>
                  {st.hint ? (
                    <p className="mt-2 truncate text-[11px] text-content-secondary" title={st.hint}>
                      Conta: {st.hint}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={st.connected ? "secondary" : "gradient"}
                      size="sm"
                      className="min-h-[44px] flex-1 min-w-[120px]"
                      onClick={() => openModal(def)}
                    >
                      {st.connected ? "Ajustar ligacao" : "Ligar agora"}
                    </Button>
                    {st.connected ? (
                      <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => quickDisconnect(def)}>
                        Desligar
                      </Button>
                    ) : null}
                    {def.slug === "google_agenda" ? (
                      <Link
                        href="/dashboard/agenda"
                        className={cn(
                          "inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-xl border px-3 text-xs font-semibold",
                          isLight
                            ? "border-slate-200 text-content-secondary hover:bg-slate-50"
                            : "border-line text-content-secondary hover:bg-surface-elevated/30",
                        )}
                      >
                        Abrir agenda
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

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

      {activeDef ? (
        <Modal
          open={true}
          onClose={closeModal}
          title={activeDef.title}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeModal} disabled={modalSaving}>
                Cancelar
              </Button>
              <Button type="button" variant="gradient" onClick={saveModal} isLoading={modalSaving}>
                <Check className="size-4" aria-hidden />
                Guardar
              </Button>
            </div>
          }
        >
          <p className="text-sm text-content-secondary">{activeDef.description}</p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-content-secondary" htmlFor="int-hint">
                Nome da conta ou nota (opcional, ate {MAX_HINT} caracteres)
              </label>
              <Input
                id="int-hint"
                value={modalHint}
                onChange={(e) => setModalHint(e.target.value.slice(0, MAX_HINT))}
                placeholder="Ex.: comercial@empresa.com"
                className="mt-1"
                maxLength={MAX_HINT}
              />
              <p className="mt-1 text-[11px] text-content-secondary">
                Nao cole passwords nem chaves secretas completas — em producao isso fica no servidor.
              </p>
            </div>
            <Toggle id="int-connected" checked={modalConnected} onChange={setModalConnected} label="Ligacao ativa" />
            {activeDef.backend === "google_agenda" ? (
              <p className="text-[11px] text-content-secondary">
                Esta opcao sincroniza com a barra lateral da Agenda. OAuth real vira numa versao com backend.
              </p>
            ) : (
              <p className="flex items-center gap-1 text-[11px] text-content-secondary">
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                Estado guardado por tenant neste navegador ate existir API.
              </p>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
