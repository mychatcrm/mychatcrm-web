"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plug,
  QrCode,
  Send,
  Share2,
  Unlink,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Modal } from "@/components/ui/Modal";
import { cn, formatBRL } from "@/lib/utils";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "@/lib/plans";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { typography } from "@/lib/typography";
import { EvolutionQrSlotPanel } from "@/components/dashboard/integrations/EvolutionQrSlotPanel";
import type { MetaStatusResponse } from "@/app/api/client/meta/status/route";
import type { TenantWhatsappConnection } from "@/lib/server/tenant-whatsapp-connections";
import type { SlotProvider, SlotPurpose } from "@/lib/server/whatsapp-slot-provider";
import { groupWhatsappLinesByPurpose } from "@/lib/whatsapp-line-grouping";
import { loadFbSdk } from "@/lib/client/facebook-sdk";
import { ExternalApiConnectorsPanel } from "./ExternalApiConnectorsPanel";

function safeRun<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function IntegracoesHub({ tenantId }: { tenantId: string }) {
  const { isLight } = usePanelAppearance();
  const [banner, setBanner] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Meta Lead Ads state ───────────────────────────────────────────────────
  const [metaStatus, setMetaStatus] = useState<MetaStatusResponse | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaLoadError, setMetaLoadError] = useState(false);
  const [metaRepairing, setMetaRepairing] = useState(false);
  const [metaDisconnecting, setMetaDisconnecting] = useState(false);
  const [metaBanner, setMetaBanner] = useState<string | null>(null);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);

  // ── WhatsApp Cloud API (Embedded Signup) state — por linha (slotIndex) ────
  type WaCloudState =
    | { connected: false }
    | { connected: true; phone_number_id: string; display_phone: string | null; verified_name: string | null };
  const [waCloudStatusBySlot, setWaCloudStatusBySlot] = useState<Record<number, WaCloudState>>({});
  const [waCloudLoadingBySlot, setWaCloudLoadingBySlot] = useState<Record<number, boolean>>({});
  const [waCloudConnectingSlot, setWaCloudConnectingSlot] = useState<number | null>(null);
  const [waCloudDisconnectingSlot, setWaCloudDisconnectingSlot] = useState<number | null>(null);
  const [waCloudBannerBySlot, setWaCloudBannerBySlot] = useState<Record<number, string | null>>({});
  const [waCloudTestPhoneBySlot, setWaCloudTestPhoneBySlot] = useState<Record<number, string>>({});
  const [waCloudTestBusySlot, setWaCloudTestBusySlot] = useState<number | null>(null);
  type WaCloudTemplateOption = { name: string; language: string | null; bodyParamCount: number };
  type WaCloudTestResult = {
    ok: boolean;
    text: string;
    code?: "invalid_token" | "outside_24h_window" | "other";
    availableTemplates?: WaCloudTemplateOption[];
  };
  const [waCloudTestResultBySlot, setWaCloudTestResultBySlot] = useState<
    Record<number, WaCloudTestResult | null>
  >({});
  const [waCloudTestTemplateBySlot, setWaCloudTestTemplateBySlot] = useState<Record<number, string>>({});
  // ── QR / Evolution — teste de envio (texto livre), mesmo padrão da API Meta ──
  const [evoTestPhoneBySlot, setEvoTestPhoneBySlot] = useState<Record<number, string>>({});
  const [evoTestBusySlot, setEvoTestBusySlot] = useState<number | null>(null);
  const [evoTestResultBySlot, setEvoTestResultBySlot] = useState<
    Record<number, { ok: boolean; text: string } | null>
  >({});
  // Pre-loaded SDK config so FB.login() can be called synchronously on click
  const waCloudConfigRef = useRef<{ app_id: string; config_id: string } | null>(null);
  // Why the SDK pre-load failed (ad blocker, CDN down) — shown on click for a precise message
  const waCloudSdkErrorRef = useRef<string | null>(null);

  // ── Linhas WhatsApp reais (Evolution + Meta) — substitui o localStorage ───
  const [slotCapacity, setSlotCapacity] = useState({ totalSlots: 2, extraSlots: 0, includedLines: 2 });
  const [connections, setConnections] = useState<TenantWhatsappConnection[]>([]);
  const [switchingSlot, setSwitchingSlot] = useState<number | null>(null);
  const [switchErrorBySlot, setSwitchErrorBySlot] = useState<Record<number, string | null>>({});
  const [switchBlockedRulesBySlot, setSwitchBlockedRulesBySlot] = useState<
    Record<number, { id: string; name: string | null }[]>
  >({});
  // Finalidade travada por linha: "forms" | "direct" | null (livre).
  const [purposeBySlot, setPurposeBySlot] = useState<Record<number, SlotPurpose | null>>({});
  const [purposeSavingSlot, setPurposeSavingSlot] = useState<number | null>(null);
  const [purposeErrorBySlot, setPurposeErrorBySlot] = useState<Record<number, string | null>>({});
  // "+ Adicionar outro número" — qual seção está alocando e o erro dela, se houver.
  const [allocatingSection, setAllocatingSection] = useState<SlotPurpose | null>(null);
  const [allocateErrorBySection, setAllocateErrorBySection] = useState<Record<SlotPurpose, string | null>>({
    forms: null,
    direct: null,
  });
  const [extraLineQty, setExtraLineQty] = useState(1);
  const [extraLineBuying, setExtraLineBuying] = useState(false);
  const [extraLineOffer, setExtraLineOffer] = useState<{
    amount_cents: number | null;
    currency: string;
    interval_unit: "month" | "year" | null;
  } | null>(null);
  const extraLinePrice = (extraLineOffer?.amount_cents ?? WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL * 100) / 100;
  const extraLineInterval = extraLineOffer?.interval_unit === "year" ? "ano" : "mês";

  const loadSlotCapacity = useCallback(async () => {
    try {
      const res = await fetch("/api/checkout/extra-whatsapp", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        extraSlots?: number;
        totalSlots?: number;
        includedLines?: number;
        offer?: {
          amount_cents: number | null;
          currency: string;
          interval_unit: "month" | "year" | null;
        } | null;
      };
      setSlotCapacity({
        totalSlots: data.totalSlots ?? 2,
        extraSlots: data.extraSlots ?? 0,
        includedLines: data.includedLines ?? 2,
      });
      setExtraLineOffer(data.offer ?? null);
    } catch {
      /* mantém capacidade anterior */
    }
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/client/whatsapp/connections", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        connections?: TenantWhatsappConnection[];
        purposes?: Record<string, SlotPurpose | null>;
      };
      setConnections(data.connections ?? []);
      const parsed: Record<number, SlotPurpose | null> = {};
      for (const [slot, purpose] of Object.entries(data.purposes ?? {})) {
        const index = Number(slot);
        if (Number.isInteger(index)) parsed[index] = purpose ?? null;
      }
      setPurposeBySlot(parsed);
    } catch {
      /* mantém lista anterior */
    }
  }, []);

  /**
   * Trava a finalidade da linha. Recusa vinda do servidor (regra da finalidade
   * oposta ainda apontando para esta linha) aparece no mesmo lugar do erro de
   * troca de método, e nada é alterado localmente.
   */
  const changeSlotPurpose = useCallback(
    async (slotIndex: number, purpose: SlotPurpose | null) => {
      setPurposeSavingSlot(slotIndex);
      setPurposeErrorBySlot((prev) => ({ ...prev, [slotIndex]: null }));
      try {
        const res = await fetch("/api/client/whatsapp/slot-purpose", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slotIndex, purpose }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Não foi possível salvar a finalidade desta linha.");
        }
        setPurposeBySlot((prev) => ({ ...prev, [slotIndex]: purpose }));
      } catch (err) {
        setPurposeErrorBySlot((prev) => ({
          ...prev,
          [slotIndex]: err instanceof Error ? err.message : "Falha ao salvar a finalidade.",
        }));
      } finally {
        setPurposeSavingSlot(null);
      }
    },
    [],
  );

  useEffect(() => {
    void loadSlotCapacity();
    void loadConnections();
  }, [loadSlotCapacity, loadConnections, tenantId]);

  useEffect(() => {
    if (searchParams.get("addon") === "success") {
      void loadSlotCapacity();
      setBanner("Pagamento confirmado. A capacidade será atualizada assim que o Stripe concluir o webhook.");
    }
  }, [loadSlotCapacity, searchParams]);

  // Mantém o badge "ativo"/"conectado" e o botão de troca atualizados mesmo
  // enquanto o EvolutionQrSlotPanel (que faz seu próprio polling) muda de
  // estado sem avisar o componente pai.
  useEffect(() => {
    const id = setInterval(() => void loadConnections(), 5_000);
    return () => clearInterval(id);
  }, [loadConnections]);

  const switchSlotProvider = useCallback(
    async (slotIndex: number, provider: SlotProvider) => {
      setSwitchingSlot(slotIndex);
      setSwitchErrorBySlot((prev) => ({ ...prev, [slotIndex]: null }));
      setSwitchBlockedRulesBySlot((prev) => ({ ...prev, [slotIndex]: [] }));
      try {
        const res = await fetch("/api/client/whatsapp/slot-provider", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slotIndex, provider }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Não foi possível trocar o método desta linha.");
        }
        const data = (await res.json().catch(() => ({}))) as {
          blockedRules?: { id: string; name: string | null }[];
        };
        setSwitchBlockedRulesBySlot((prev) => ({ ...prev, [slotIndex]: data.blockedRules ?? [] }));
        await loadConnections();
      } catch (err) {
        setSwitchErrorBySlot((prev) => ({
          ...prev,
          [slotIndex]: err instanceof Error ? err.message : "Erro ao trocar o método desta linha.",
        }));
      } finally {
        setSwitchingSlot(null);
      }
    },
    [loadConnections],
  );

  const buyExtraLine = useCallback(async () => {
    setExtraLineBuying(true);
    setBanner(null);
    try {
      const response = await fetch("/api/checkout/extra-whatsapp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: extraLineQty }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "Não foi possível abrir o checkout.");
      window.location.assign(data.url);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Não foi possível iniciar a compra de uma linha extra.");
      setExtraLineBuying(false);
    }
  }, [extraLineQty]);

  // ── Load Meta status on mount / after OAuth redirect ─────────────────────
  const loadMetaStatus = useCallback(async (): Promise<MetaStatusResponse | null> => {
    setMetaLoading(true);
    try {
      const res = await fetch("/api/client/meta/status", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to load Meta status");

      const data = (await res.json()) as MetaStatusResponse;
      const pages = data.pages ?? [];
      const nextStatus = {
        connected: Boolean(data.connected),
        action_required: Boolean(data.action_required),
        verification_pending: Boolean(data.verification_pending),
        grant_discovery_status: data.grant_discovery_status ?? null,
        grant_error_code: data.grant_error_code ?? null,
        pages,
      } satisfies MetaStatusResponse;
      setMetaStatus(nextStatus);
      setMetaLoadError(false);
      return nextStatus;
    } catch {
      // Preserve the last known state: a temporary API outage is not a
      // disconnection and must never invite the customer to reconnect blindly.
      setMetaLoadError(true);
      return null;
    } finally {
      setMetaLoading(false);
    }
  }, []);

  // ── WhatsApp Cloud status — carregado por linha ───────────────────────────
  const loadWaCloudStatus = useCallback(async (slotIndex: number): Promise<WaCloudState | null> => {
    setWaCloudLoadingBySlot((prev) => ({ ...prev, [slotIndex]: true }));
    try {
      const res = await fetch(`/api/client/whatsapp-cloud/status?slotIndex=${slotIndex}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to load WhatsApp Cloud status");
      const data = (await res.json()) as WaCloudState;
      setWaCloudStatusBySlot((prev) => ({ ...prev, [slotIndex]: data }));
      return data;
    } catch {
      setWaCloudStatusBySlot((prev) => ({ ...prev, [slotIndex]: { connected: false } }));
      return null;
    } finally {
      setWaCloudLoadingBySlot((prev) => ({ ...prev, [slotIndex]: false }));
    }
  }, []);

  useEffect(() => {
    for (let slotIndex = 0; slotIndex < slotCapacity.totalSlots; slotIndex += 1) {
      void loadWaCloudStatus(slotIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotCapacity.totalSlots]);

  // Pre-load the FB SDK once on mount so window.FB is ready before the user
  // clicks Conectar em qualquer linha — FB.login() precisa ser síncrono no
  // gesto do usuário (senão o popup é bloqueado).
  useEffect(() => {
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
  }, []);

  // Show banner if redirected back from OAuth
  useEffect(() => {
    const meta = searchParams.get("meta");
    if (meta === "connected") {
      void loadMetaStatus().then((status) => {
        setMetaBanner(
          status?.connected
            ? "✅ Página Meta verificada: permissões e webhook estão prontos."
            : status
              ? "A Meta retornou a conta, mas a verificação ainda exige uma ação."
              : "A Meta retornou a conta, mas não foi possível atualizar o estado agora. Tente verificar novamente.",
        );
      });
    } else if (meta === "partial") {
      setMetaBanner(
        "A autorização foi recebida. O MyChatCRM está concluindo automaticamente a descoberta e a verificação das Páginas.",
      );
      void loadMetaStatus();
    } else if (meta === "action_required") {
      setMetaBanner(
        "A conexão não foi ativada porque a Meta não confirmou todas as permissões ou o webhook.",
      );
      void loadMetaStatus();
    } else if (meta === "denied") {
      setMetaBanner("Autorização cancelada no Facebook. Tente novamente.");
    } else if (meta === "no_pages") {
      setMetaBanner("Nenhuma página Facebook encontrada nesta conta.");
    } else if (meta === "error") {
      setMetaBanner("Erro ao conectar com a Meta. Tente novamente.");
    } else {
      void loadMetaStatus();
    }
  }, [searchParams, loadMetaStatus]);

  useEffect(() => {
    // Fallback de redirect OAuth (fora do fluxo principal via popup) sempre
    // aponta para a linha 0 — é o mesmo default usado no lado do servidor.
    const wa = searchParams.get("whatsapp");
    if (wa === "connected") {
      void loadWaCloudStatus(0).then((status) => {
        setWaCloudBannerBySlot((prev) => ({
          ...prev,
          0: status?.connected ? "✅ WhatsApp API Oficial conectado com sucesso!" : "Nenhum número WhatsApp Business encontrado.",
        }));
      });
    } else if (wa === "denied") {
      setWaCloudBannerBySlot((prev) => ({ ...prev, 0: "Conexão cancelada. Tente novamente." }));
    } else if (wa === "no_numbers") {
      setWaCloudBannerBySlot((prev) => ({ ...prev, 0: "Nenhum número WhatsApp Business encontrado na conta Meta." }));
    } else if (wa === "error") {
      setWaCloudBannerBySlot((prev) => ({ ...prev, 0: "Erro ao conectar com a Meta. Tente novamente." }));
    }
  }, [searchParams, loadWaCloudStatus]);

  const repairMeta = useCallback(async () => {
    setMetaRepairing(true);
    setMetaBanner(null);
    try {
      const res = await fetch("/api/client/meta/repair", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        pages?: Array<{ message?: string | null }>;
      };
      await loadMetaStatus();
      if (data.ok) {
        setMetaBanner("✅ Conexão Meta verificada e assinatura de leads confirmada.");
      } else {
        setMetaBanner(
          data.pages?.find((page) => page.message)?.message ??
            data.error ??
            "A Meta ainda exige uma ação. Reconecte a conta e aprove todas as permissões.",
        );
      }
    } catch {
      setMetaBanner("Não foi possível verificar a conexão Meta agora. Tente novamente.");
    } finally {
      setMetaRepairing(false);
    }
  }, [loadMetaStatus]);

  const disconnectMeta = useCallback(async () => {
    setMetaDisconnecting(true);
    try {
      const res = await fetch("/api/client/meta/disconnect", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error("Unable to disconnect Meta");

      setMetaStatus({
        connected: false,
        action_required: false,
        verification_pending: false,
        grant_discovery_status: null,
        grant_error_code: null,
        pages: [],
      });
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

  const disconnectWaCloud = useCallback(
    async (slotIndex: number) => {
      setWaCloudDisconnectingSlot(slotIndex);
      try {
        const res = await fetch(`/api/client/whatsapp-cloud/disconnect?slotIndex=${slotIndex}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("Unable to disconnect");
        setWaCloudStatusBySlot((prev) => ({ ...prev, [slotIndex]: { connected: false } }));
        setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: null }));
        void loadConnections();
      } catch {
        setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "Erro ao desconectar. Tente novamente." }));
      } finally {
        setWaCloudDisconnectingSlot(null);
      }
    },
    [loadConnections],
  );

  const sendEvoTest = useCallback(async (slotIndex: number) => {
    const toNumber = (evoTestPhoneBySlot[slotIndex] ?? "").replace(/\D/g, "");
    setEvoTestBusySlot(slotIndex);
    setEvoTestResultBySlot((prev) => ({ ...prev, [slotIndex]: null }));
    try {
      const res = await fetch("/api/client/whatsapp/evolution/test-send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex, toNumber }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setEvoTestResultBySlot((prev) => ({
          ...prev,
          [slotIndex]: { ok: false, text: data.error ?? "Falha ao enviar teste." },
        }));
        return;
      }
      setEvoTestResultBySlot((prev) => ({ ...prev, [slotIndex]: { ok: true, text: "Enviado com sucesso." } }));
    } catch {
      setEvoTestResultBySlot((prev) => ({ ...prev, [slotIndex]: { ok: false, text: "Erro de rede ao enviar teste." } }));
    } finally {
      setEvoTestBusySlot(null);
    }
  }, [evoTestPhoneBySlot]);

  const sendWaCloudTest = useCallback(async (slotIndex: number, templateName?: string) => {
    const toNumber = (waCloudTestPhoneBySlot[slotIndex] ?? "").replace(/\D/g, "");
    setWaCloudTestBusySlot(slotIndex);
    setWaCloudTestResultBySlot((prev) => ({ ...prev, [slotIndex]: null }));
    try {
      const res = await fetch("/api/client/whatsapp-cloud/test-send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIndex, toNumber, ...(templateName ? { templateName } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        messageId?: string | null;
        code?: "invalid_token" | "outside_24h_window" | "other";
        availableTemplates?: WaCloudTemplateOption[];
      };
      if (!res.ok || !data.ok) {
        setWaCloudTestResultBySlot((prev) => ({
          ...prev,
          [slotIndex]: {
            ok: false,
            text: data.error ?? "Falha ao enviar teste.",
            code: data.code,
            availableTemplates: data.availableTemplates,
          },
        }));
        return;
      }
      setWaCloudTestResultBySlot((prev) => ({
        ...prev,
        [slotIndex]: {
          ok: true,
          text: data.messageId
            ? `Enviado com sucesso (id ${data.messageId}).`
            : "Enviado com sucesso.",
        },
      }));
    } catch {
      setWaCloudTestResultBySlot((prev) => ({
        ...prev,
        [slotIndex]: { ok: false, text: "Erro de rede ao enviar teste." },
      }));
    } finally {
      setWaCloudTestBusySlot(null);
    }
  }, [waCloudTestPhoneBySlot]);

  // FB.login() must be called synchronously within the user-gesture context.
  // The SDK and config_id are pre-loaded on mount (see useEffect above) so no
  // awaits are needed before calling FB.login(), preventing popup blockers.
  const connectWaCloud = useCallback((slotIndex: number, allowSwap = false) => {
    const cfg = waCloudConfigRef.current;
    if (!window.FB || !cfg) {
      const reason = waCloudSdkErrorRef.current;
      setWaCloudBannerBySlot((prev) => ({
        ...prev,
        [slotIndex]: reason
          ? `Não foi possível carregar o SDK da Meta (${reason}). Desative bloqueadores de anúncio para este site e recarregue a página.`
          : "SDK Meta ainda carregando. Aguarde um instante e tente novamente.",
      }));
      return;
    }

    setWaCloudConnectingSlot(slotIndex);
    setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: null }));

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
        setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "O popup do Facebook não respondeu. Permita popups para este site e tente novamente." }));
        setWaCloudConnectingSlot(null);
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
              setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "Conexão cancelada ou não autorizada." }));
              setWaCloudConnectingSlot(null);
              return;
            }

            // The FINISH postMessage can land moments after this callback fires —
            // wait up to 3 s for the ids before concluding no number exists.
            for (let i = 0; i < 30 && (!wabaId || !phoneNumberId); i++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            cleanup();

            if (!wabaId || !phoneNumberId) {
              setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "Nenhum número WhatsApp Business encontrado. Tente novamente." }));
              setWaCloudConnectingSlot(null);
              return;
            }

            try {
              const exchRes = await fetch("/api/client/whatsapp-cloud/exchange-code", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  code: response.authResponse.code,
                  waba_id: wabaId,
                  phone_number_id: phoneNumberId,
                  slotIndex,
                  ...(allowSwap ? { allowSwap: true } : {}),
                }),
              });
              const exchData = (await exchRes.json()) as {
                connected?: boolean;
                phone_number_id?: string;
                display_phone?: string | null;
                verified_name?: string | null;
                error?: string;
              };
              if (exchData.connected && exchData.phone_number_id) {
                setWaCloudStatusBySlot((prev) => ({
                  ...prev,
                  [slotIndex]: {
                    connected: true,
                    phone_number_id: exchData.phone_number_id!,
                    display_phone: exchData.display_phone ?? null,
                    verified_name: exchData.verified_name ?? null,
                  },
                }));
                setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "✅ WhatsApp API Oficial conectado com sucesso!" }));
                void loadConnections();
              } else {
                setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "Erro ao salvar conexão. Tente novamente." }));
              }
            } catch {
              setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: "Erro de rede ao salvar conexão. Tente novamente." }));
            } finally {
              setWaCloudConnectingSlot(null);
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
      setWaCloudBannerBySlot((prev) => ({ ...prev, [slotIndex]: `Erro ao iniciar conexão Meta: ${msg}. Tente novamente.` }));
      console.error("[connectWaCloud]", msg);
      setWaCloudConnectingSlot(null);
    }
  }, [loadConnections]);

  const slotIndices = useMemo(
    () => Array.from({ length: slotCapacity.totalSlots }, (_, i) => i),
    [slotCapacity.totalSlots],
  );

  const connectionsBySlot = useMemo(() => {
    const map = new Map<number, { evo: TenantWhatsappConnection | null; meta: TenantWhatsappConnection | null }>();
    for (const slotIndex of slotIndices) {
      map.set(slotIndex, {
        evo: connections.find((c) => c.slotIndex === slotIndex && c.transport === "evolution") ?? null,
        meta: connections.find((c) => c.slotIndex === slotIndex && c.transport === "cloud_api") ?? null,
      });
    }
    return map;
  }, [connections, slotIndices]);

  // Eixo da tela: duas seções fixas por finalidade, não "Linha N" numerada.
  // groupWhatsappLinesByPurpose é puro — testado em unidade separadamente.
  const lineGrouping = useMemo(
    () =>
      groupWhatsappLinesByPurpose(
        slotIndices.map((slotIndex) => {
          const pair = connectionsBySlot.get(slotIndex);
          return {
            slotIndex,
            purpose: purposeBySlot[slotIndex] ?? null,
            connected: Boolean(pair?.evo?.connected) || Boolean(pair?.meta?.connected),
          };
        }),
      ),
    [slotIndices, connectionsBySlot, purposeBySlot],
  );

  const allocateLine = useCallback(
    async (purpose: SlotPurpose) => {
      setAllocatingSection(purpose);
      setAllocateErrorBySection((prev) => ({ ...prev, [purpose]: null }));
      try {
        const res = await fetch("/api/client/whatsapp/allocate-line", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Não foi possível liberar outra linha.");
        }
        await Promise.all([loadConnections(), loadSlotCapacity()]);
      } catch (err) {
        setAllocateErrorBySection((prev) => ({
          ...prev,
          [purpose]: err instanceof Error ? err.message : "Falha ao adicionar outro número.",
        }));
      } finally {
        setAllocatingSection(null);
      }
    },
    [loadConnections, loadSlotCapacity],
  );

  const metaPages = metaStatus?.pages ?? [];
  const metaConnected = Boolean(metaStatus?.connected);
  const metaHasPages = metaPages.length > 0;
  const metaActionRequired = Boolean(metaStatus?.action_required);
  const metaVerificationPending = Boolean(metaStatus?.verification_pending);
  const metaGrantPending =
    metaStatus?.grant_discovery_status === "pending" ||
    metaStatus?.grant_discovery_status === "discovering" ||
    metaStatus?.grant_discovery_status === "retrying";
  const visibleMetaBanner = metaBanner;

  const waLineStatus = useMemo(() => {
    const ready = slotIndices.filter((slotIndex) => {
      const pair = connectionsBySlot.get(slotIndex);
      return Boolean(pair?.evo?.connected) || Boolean(pair?.meta?.connected);
    }).length;
    return { waLinesReady: ready, waLineCount: slotIndices.length };
  }, [connectionsBySlot, slotIndices]);

  /**
   * Cartão de uma linha — reusado nas duas seções fixas (Formulários Meta /
   * WhatsApp Direto) e na faixa isolada de linhas sem finalidade ainda.
   * `sectionPurpose` não nulo esconde o seletor de finalidade (a seção já É a
   * finalidade); só a faixa de migração passa `null` e mostra o seletor.
   */
  const renderLineCard = (slotIndex: number, sectionPurpose: SlotPurpose | null) => {
    const pair = connectionsBySlot.get(slotIndex);
    const evoConnected = Boolean(pair?.evo?.connected);
    const metaConnected2 = Boolean(pair?.meta?.connected);
    const activeProvider: SlotProvider = pair?.evo?.activeProvider ?? pair?.meta?.activeProvider ?? "evolution";
    const bothConnected = evoConnected && metaConnected2;
    const waCloudStatus = waCloudStatusBySlot[slotIndex] ?? null;
    const waCloudLoading = waCloudLoadingBySlot[slotIndex] ?? true;
    const waCloudBanner = waCloudBannerBySlot[slotIndex] ?? null;
    const waCloudConnecting = waCloudConnectingSlot === slotIndex;
    const waCloudDisconnecting = waCloudDisconnectingSlot === slotIndex;
    const switchError = switchErrorBySlot[slotIndex] ?? null;
    const switchBlockedRules = switchBlockedRulesBySlot[slotIndex] ?? [];
    const linePurpose = purposeBySlot[slotIndex] ?? null;
    const purposeSaving = purposeSavingSlot === slotIndex;
    const purposeError = purposeErrorBySlot[slotIndex] ?? null;
    // Um método por vez: o lado inativo, quando conectado, disponibiliza-se
    // como conexão nova para o OUTRO método — não pode furar a trava.
    const qrAllowSwap = metaConnected2 && !evoConnected;
    const cloudAllowSwap = evoConnected && !metaConnected2;

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
            <p className="text-sm font-semibold text-content">Linha {slotIndex + 1}</p>
            {!bothConnected ? (
              <p className="mt-0.5 text-[11px] text-content-muted">
                {evoConnected || metaConnected2
                  ? `Respondendo por ${activeProvider === "cloud_api" ? "API Meta" : "QR Code"}.`
                  : "Ainda sem número conectado nesta linha."}
              </p>
            ) : null}
          </div>
        </div>

        {sectionPurpose === null ? (
          // Faixa de migração: linha com número conectado mas sem finalidade
          // travada ainda — só aqui o seletor antigo continua disponível.
          <div className="mt-3 rounded-lg border border-line/70 bg-surface-card/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <label
                  className="text-[11px] font-semibold uppercase tracking-wide text-content-muted"
                  htmlFor={`line-purpose-${slotIndex}`}
                >
                  Finalidade desta linha
                </label>
                <p className="mt-0.5 text-[11px] leading-relaxed text-content-muted">
                  Escolha pra mover esta linha pra uma das seções acima.
                </p>
              </div>
              <select
                id={`line-purpose-${slotIndex}`}
                value={linePurpose ?? ""}
                disabled={purposeSaving}
                onChange={(event) =>
                  void changeSlotPurpose(
                    slotIndex,
                    event.target.value === "" ? null : (event.target.value as SlotPurpose),
                  )
                }
                className="h-9 shrink-0 rounded-lg border border-line bg-surface-card px-2.5 text-xs text-content outline-none focus:border-primary/60 disabled:opacity-60"
              >
                <option value="">Sem finalidade</option>
                <option value="forms">Formulários Meta</option>
                <option value="direct">WhatsApp direto</option>
              </select>
            </div>
            {purposeError ? (
              <p className={cn("mt-2 text-[11px] leading-relaxed", isLight ? "text-amber-800" : "text-amber-300/90")}>
                {purposeError}
              </p>
            ) : null}
          </div>
        ) : null}

        {bothConnected ? (
          <div
            className={cn(
              "mt-3 space-y-2 rounded-lg border px-3 py-2.5 text-xs",
              isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
            )}
          >
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Esta linha tem QR e API Meta conectados ao mesmo tempo. Escolha qual mantém — a outra precisa ser
              desconectada manualmente ali embaixo depois.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={switchingSlot === slotIndex}
                isLoading={switchingSlot === slotIndex && activeProvider !== "evolution"}
                onClick={() => void switchSlotProvider(slotIndex, "evolution")}
              >
                Manter QR Code
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={switchingSlot === slotIndex}
                isLoading={switchingSlot === slotIndex && activeProvider !== "cloud_api"}
                onClick={() => void switchSlotProvider(slotIndex, "cloud_api")}
              >
                Manter API Meta
              </Button>
            </div>
            {switchError ? <p className="text-rose-700 dark:text-rose-300">{switchError}</p> : null}
          </div>
        ) : null}
        {switchBlockedRules.length > 0 ? (
          <div
            className={cn(
              "mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
            )}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              {switchBlockedRules.length === 1 ? "A regra" : "As regras"}{" "}
              <strong>{switchBlockedRules.map((rule) => rule.name ?? "sem nome").join(", ")}</strong>{" "}
              {switchBlockedRules.length === 1 ? "continua" : "continuam"} respondendo pelo QR Code — precisa de um
              template do WhatsApp aprovado pela Meta para o 1º contacto de Lead Ads.
            </p>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* ── Coluna QR / Evolution ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-content">
                <QrCode className="size-3.5 shrink-0 text-primary" aria-hidden />
                QR Code
              </p>
              {evoConnected ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Conectado
                </span>
              ) : qrAllowSwap ? (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
                  Trocar método
                </span>
              ) : null}
            </div>
            <EvolutionQrSlotPanel
              key={`evo-qr-${tenantId}-${slotIndex}`}
              slotIndex={slotIndex}
              autoProvision={false}
              allowSwap={qrAllowSwap}
            />
            {evoConnected ? (
              <div className="space-y-2 rounded-xl border border-line/70 bg-surface-card/40 p-3">
                <p className="text-xs font-semibold text-content">Teste de envio (texto livre)</p>
                <p className="text-[11px] leading-relaxed text-content-muted">
                  Envia «Teste MyChatCRM — QR Code OK» para validar esta conexão.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="5562999999999"
                    value={evoTestPhoneBySlot[slotIndex] ?? ""}
                    onChange={(event) =>
                      setEvoTestPhoneBySlot((prev) => ({
                        ...prev,
                        [slotIndex]: event.target.value.replace(/[^\d+\s()-]/g, ""),
                      }))
                    }
                    className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                  />
                  <Button
                    type="button"
                    className="shrink-0 gap-1.5"
                    isLoading={evoTestBusySlot === slotIndex}
                    disabled={!(evoTestPhoneBySlot[slotIndex] ?? "").replace(/\D/g, "")}
                    onClick={() => void sendEvoTest(slotIndex)}
                  >
                    <Send className="size-3.5" aria-hidden />
                    Enviar teste
                  </Button>
                </div>
                {evoTestResultBySlot[slotIndex] ? (
                  <p
                    className={cn(
                      "text-[11px] leading-relaxed",
                      evoTestResultBySlot[slotIndex]?.ok
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-amber-800 dark:text-amber-300",
                    )}
                  >
                    {evoTestResultBySlot[slotIndex]?.text}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── Coluna API Meta ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-content">
                <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-hidden />
                API Meta
              </p>
              {metaConnected2 ? (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Conectado
                </span>
              ) : cloudAllowSwap ? (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
                  Trocar método
                </span>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border border-line bg-surface-deep/30 p-4 text-sm text-content-secondary">
              {waCloudBanner ? (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
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
                    {waCloudBanner.startsWith("✅") ? <BadgeCheck className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
                  </span>
                  <p>{waCloudBanner}</p>
                </div>
              ) : null}

              {waCloudLoading ? (
                <div className="flex items-center gap-2 text-xs text-content-muted">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  A verificar conexão…
                </div>
              ) : waCloudStatus?.connected ? (
                <div className="space-y-3">
                  <div
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3",
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
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 border-rose-500/30 text-rose-600 hover:border-rose-500/50 hover:bg-rose-500/5 dark:text-rose-400"
                    isLoading={waCloudDisconnecting}
                    onClick={() => void disconnectWaCloud(slotIndex)}
                  >
                    <Unlink className="size-4" aria-hidden />
                    Desconectar API Meta
                  </Button>

                  <div className="space-y-2 rounded-xl border border-line/70 bg-surface-card/40 p-3">
                    <p className="text-xs font-semibold text-content">Teste de envio (texto livre)</p>
                    <p className="text-[11px] leading-relaxed text-content-muted">
                      Envia «Teste MyChatCRM — API Meta OK» para validar o token/número. Fora da janela de 24h a
                      Meta pode recusar (131047) — Lead Ads usa template aprovado.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="5562999999999"
                        value={waCloudTestPhoneBySlot[slotIndex] ?? ""}
                        onChange={(event) =>
                          setWaCloudTestPhoneBySlot((prev) => ({
                            ...prev,
                            [slotIndex]: event.target.value.replace(/[^\d+\s()-]/g, ""),
                          }))
                        }
                        className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                      />
                      <Button
                        type="button"
                        className="shrink-0 gap-1.5"
                        isLoading={waCloudTestBusySlot === slotIndex}
                        disabled={!(waCloudTestPhoneBySlot[slotIndex] ?? "").replace(/\D/g, "")}
                        onClick={() => void sendWaCloudTest(slotIndex)}
                      >
                        <Send className="size-3.5" aria-hidden />
                        Enviar teste
                      </Button>
                    </div>
                    {waCloudTestResultBySlot[slotIndex] ? (
                      <p
                        className={cn(
                          "text-[11px] leading-relaxed",
                          waCloudTestResultBySlot[slotIndex]?.ok
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-amber-800 dark:text-amber-300",
                        )}
                      >
                        {waCloudTestResultBySlot[slotIndex]?.text}
                      </p>
                    ) : null}
                    {waCloudTestResultBySlot[slotIndex]?.code === "invalid_token" ? (
                      <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                        Use o botão <strong>“Desconectar API Meta”</strong> acima e reconecte para gerar um token
                        novo.
                      </p>
                    ) : null}
                    {waCloudTestResultBySlot[slotIndex]?.code === "outside_24h_window" ? (
                      (waCloudTestResultBySlot[slotIndex]?.availableTemplates?.length ?? 0) > 0 ? (
                        <div className="space-y-2 rounded-lg border border-line/60 bg-surface-card/60 p-2.5">
                          <p className="text-[11px] font-semibold text-content">
                            Validar mesmo assim com um template aprovado
                          </p>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <select
                              value={waCloudTestTemplateBySlot[slotIndex] ?? ""}
                              onChange={(event) =>
                                setWaCloudTestTemplateBySlot((prev) => ({
                                  ...prev,
                                  [slotIndex]: event.target.value,
                                }))
                              }
                              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                            >
                              <option value="">Selecione um template aprovado</option>
                              {waCloudTestResultBySlot[slotIndex]?.availableTemplates?.map((t) => (
                                <option key={t.name} value={t.name}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0 gap-1.5"
                              isLoading={waCloudTestBusySlot === slotIndex}
                              disabled={!waCloudTestTemplateBySlot[slotIndex]}
                              onClick={() => void sendWaCloudTest(slotIndex, waCloudTestTemplateBySlot[slotIndex])}
                            >
                              <Send className="size-3.5" aria-hidden />
                              Enviar via template aprovado
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-content-muted">
                          Nenhum template aprovado encontrado nesta WABA para usar como alternativa — aprove um no
                          Gerenciador da Meta pra poder validar fora da janela de 24h.
                        </p>
                      )
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-content-secondary">
                    {cloudAllowSwap
                      ? "Conectar aqui troca o método desta linha: assim que confirmar, o QR Code é desligado sozinho."
                      : "Conecte via Meta API Oficial. O processo é guiado pela própria Meta — sem copiar chaves ou configurações manuais."}
                  </p>
                  <Button
                    type="button"
                    isLoading={waCloudConnecting}
                    onClick={() => connectWaCloud(slotIndex, cloudAllowSwap)}
                    className="min-h-[44px] gap-2 bg-primary px-5 text-white hover:bg-primary-hover"
                  >
                    {!waCloudConnecting && <ExternalLink className="size-4" aria-hidden />}
                    {cloudAllowSwap ? "Trocar para API Meta" : "Conectar API Meta"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

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
                Um número pra <strong className="text-content">Formulários Meta</strong> e outro pra{" "}
                <strong className="text-content">WhatsApp Direto</strong> — cada um usa QR ou API Meta, nunca os
                dois ao mesmo tempo. Compre linhas extra pra adicionar mais números a qualquer uma das seções.
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
            {waLineStatus.waLinesReady}/{waLineStatus.waLineCount} conectadas
          </Badge>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          {slotCapacity.extraSlots > 0 ? (
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
                Tem <strong className="text-content">{slotCapacity.extraSlots}</strong>{" "}
                {slotCapacity.extraSlots === 1 ? "linha extra contratada" : "linhas extra contratadas"} (
                {formatBRL(extraLinePrice)}/{extraLineInterval} por linha), além das{" "}
                {slotCapacity.includedLines} do plano. Cada número <strong className="text-content">liga-se aqui</strong>{" "}
                (QR ou API da Meta); a compra só define quantas linhas — não pede telefone no checkout.
              </p>
            </div>
          ) : null}
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4",
              isLight ? "border-primary/20 bg-primary/[0.04]" : "border-primary/25 bg-primary/[0.06]",
            )}
          >
            <div className="min-w-0">
              <p className="font-semibold text-content">Adicionar linha WhatsApp</p>
              <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                Compra uma capacidade extra para conectar outro número nesta página. A nova linha só é liberada após confirmação do Stripe.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label="Diminuir quantidade de linhas"
                disabled={extraLineQty <= 1 || extraLineBuying}
                onClick={() => setExtraLineQty((value) => Math.max(1, value - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-card font-semibold text-content transition hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50"
              >
                −
              </button>
              <span className="min-w-6 text-center text-sm font-semibold tabular-nums text-content">{extraLineQty}</span>
              <button
                type="button"
                aria-label="Aumentar quantidade de linhas"
                disabled={extraLineQty >= 10 || extraLineBuying}
                onClick={() => setExtraLineQty((value) => Math.min(10, value + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-card font-semibold text-content transition hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50"
              >
                +
              </button>
              <Button type="button" onClick={() => void buyExtraLine()} isLoading={extraLineBuying}>
                Comprar linha
              </Button>
            </div>
          </div>
          <p className="text-sm text-content-secondary">
            Com <strong className="text-content">QR</strong>, o código é gerado no seu servidor WhatsApp (Evolution) e aparece aqui. Com <strong className="text-content">API Meta</strong>, o
            caminho oficial para número verificado e envios em massa. Cada número usa só um dos dois — pra trocar de
            método, use «Trocar método» dentro da linha.
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
          <div className="space-y-6">
            {/* ── Seção Formulários Meta ── */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-content">Formulários Meta</h4>
                {lineGrouping.forms.length > 0 && lineGrouping.freeCapacity > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    isLoading={allocatingSection === "forms"}
                    onClick={() => void allocateLine("forms")}
                  >
                    + Adicionar outro número
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-content-muted">
                Número que atende leads de Lead Ads. Escolha QR ou API Meta — nunca os dois ao mesmo tempo.
              </p>
              {allocateErrorBySection.forms ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">{allocateErrorBySection.forms}</p>
              ) : null}
              {lineGrouping.forms.length > 0 ? (
                lineGrouping.forms.map((slotIndex) => renderLineCard(slotIndex, "forms"))
              ) : (
                <div className="rounded-xl border border-dashed border-line/70 bg-surface-deep/20 p-4 text-center">
                  <p className="text-xs text-content-muted">Nenhum número conectado ainda.</p>
                  <Button
                    type="button"
                    className="mt-2"
                    size="sm"
                    isLoading={allocatingSection === "forms"}
                    disabled={lineGrouping.freeCapacity === 0}
                    onClick={() => void allocateLine("forms")}
                  >
                    Conectar número
                  </Button>
                  {lineGrouping.freeCapacity === 0 ? (
                    <p className="mt-2 text-[11px] text-content-muted">Sem capacidade livre — compre mais uma linha acima.</p>
                  ) : null}
                </div>
              )}
            </div>

            {/* ── Seção WhatsApp Direto ── */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-content">WhatsApp Direto</h4>
                {lineGrouping.direct.length > 0 && lineGrouping.freeCapacity > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    isLoading={allocatingSection === "direct"}
                    onClick={() => void allocateLine("direct")}
                  >
                    + Adicionar outro número
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-content-muted">
                Número que atende contato espontâneo, sem formulário. Escolha QR ou API Meta — nunca os dois ao mesmo tempo.
              </p>
              {allocateErrorBySection.direct ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">{allocateErrorBySection.direct}</p>
              ) : null}
              {lineGrouping.direct.length > 0 ? (
                lineGrouping.direct.map((slotIndex) => renderLineCard(slotIndex, "direct"))
              ) : (
                <div className="rounded-xl border border-dashed border-line/70 bg-surface-deep/20 p-4 text-center">
                  <p className="text-xs text-content-muted">Nenhum número conectado ainda.</p>
                  <Button
                    type="button"
                    className="mt-2"
                    size="sm"
                    isLoading={allocatingSection === "direct"}
                    disabled={lineGrouping.freeCapacity === 0}
                    onClick={() => void allocateLine("direct")}
                  >
                    Conectar número
                  </Button>
                  {lineGrouping.freeCapacity === 0 ? (
                    <p className="mt-2 text-[11px] text-content-muted">Sem capacidade livre — compre mais uma linha acima.</p>
                  ) : null}
                </div>
              )}
            </div>

            {/* ── Faixa de migração: linha conectada sem finalidade travada ── */}
            {lineGrouping.pendingWithConnection.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-content">Linhas sem finalidade definida</h4>
                <p className="text-xs text-content-muted">
                  Conectadas antes desta separação existir. Escolha a finalidade de cada uma pra mover pra uma das
                  seções acima.
                </p>
                {lineGrouping.pendingWithConnection.map((slotIndex) => renderLineCard(slotIndex, null))}
              </div>
            ) : null}
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
              metaActionRequired
                ? cn("border-amber-500/40 bg-amber-500/15", isLight ? "text-amber-800" : "text-amber-300")
                : metaLoadError
                  ? cn("border-amber-500/40 bg-amber-500/15", isLight ? "text-amber-800" : "text-amber-300")
                : metaVerificationPending
                  ? cn("border-blue-500/40 bg-blue-500/15", isLight ? "text-blue-800" : "text-blue-300")
                : metaConnected
                  ? cn("border-emerald-500/40 bg-emerald-500/15", isLight ? "text-emerald-700" : "text-emerald-300")
                : "border-line bg-surface-elevated/50 text-content-secondary",
            )}
          >
            {metaLoading
              ? "..."
              : metaActionRequired
                ? "Ação necessária"
                : metaLoadError
                  ? "Indisponível"
                : metaVerificationPending
                  ? "Verificando"
                : metaConnected
                  ? "Conectado"
                  : "Não conectado"}
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
          ) : metaLoadError && !metaStatus ? (
            <div className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
              <p className="text-sm text-content-secondary">
                Não foi possível consultar a conexão agora. Nenhuma configuração foi alterada.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void loadMetaStatus()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : metaGrantPending && !metaHasPages ? (
            <div className="space-y-3 rounded-lg border border-blue-500/25 bg-blue-500/10 p-4">
              <div className="flex items-start gap-2">
                <Loader2
                  className={cn(
                    "mt-0.5 size-4 shrink-0 animate-spin",
                    isLight ? "text-blue-700" : "text-blue-300",
                  )}
                  aria-hidden
                />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-content">
                    Finalizando a conexão Meta
                  </p>
                  <p className="text-xs text-content-secondary">
                    A autorização já foi salva. O MyChatCRM continuará procurando e
                    verificando as Páginas automaticamente; não é necessário
                    desconectar nem repetir o login.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void repairMeta()}
                isLoading={metaRepairing}
                disabled={metaRepairing}
              >
                Verificar agora
              </Button>
            </div>
          ) : metaHasPages ? (
            <div className="space-y-4">
              {metaPages.map((page) => {
                const pageOperational =
                  (page.health_status === "ready" ||
                    page.health_status === "degraded" ||
                    page.health_status === "legacy_grace") &&
                  !page.forms_error;
                const leadAccessVerified =
                  page.lead_access_status === "verified_by_retrieval" ||
                  page.lead_access_status === "verified_by_delivery";
                const pageReady = pageOperational && leadAccessVerified;
                return (
                  <details
                    key={page.page_id}
                    open={!pageReady}
                    className={cn(
                      "rounded-lg border",
                      pageReady
                        ? isLight
                          ? "border-blue-100 bg-blue-50/30"
                          : "border-blue-500/15 bg-blue-500/[0.05]"
                        : isLight
                          ? "border-amber-200 bg-amber-50/50"
                          : "border-amber-500/25 bg-amber-500/[0.07]",
                    )}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 text-sm font-semibold text-content">
                        {pageReady ? (
                          <BadgeCheck className={cn("size-4 shrink-0", isLight ? "text-emerald-600" : "text-emerald-400")} aria-hidden />
                        ) : pageOperational && page.lead_access_status !== "action_required" ? (
                          <Loader2 className={cn("size-4 shrink-0 animate-spin", isLight ? "text-blue-700" : "text-blue-300")} aria-hidden />
                        ) : (
                          <AlertTriangle className={cn("size-4 shrink-0", isLight ? "text-amber-700" : "text-amber-300")} aria-hidden />
                        )}
                        {page.page_name ?? page.page_id}
                      </span>
                      <ChevronDown className="size-4 shrink-0 text-content-muted transition-transform [[open]_summary_&]:rotate-180" aria-hidden />
                    </summary>
                    <div className="space-y-3 border-t border-line/30 px-4 py-3">
                      <p className="text-xs text-content-secondary">
                        ID da página: <code className="rounded bg-surface-elevated/60 px-1">{page.page_id}</code>
                      </p>
                      {!pageOperational ? (
                        <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-content-secondary">
                          {page.health_message ??
                            (page.forms_error
                              ? "A Meta não permitiu consultar os formulários desta Página."
                              : "A conexão ainda não passou por todas as verificações.")}
                        </div>
                      ) : null}
                      {pageOperational && page.lead_access_status === "pending_first_lead" ? (
                        <div className="rounded-md border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-content-secondary">
                          A configuração técnica está pronta. O primeiro lead confirmará a entrega
                          ponta a ponta. Normalmente nenhuma ação adicional é necessária; se a
                          empresa personalizou o Acesso a Leads na Meta, o administrador deverá
                          atribuir o CRM MyChatCRM a esta Página.
                        </div>
                      ) : null}
                      {pageOperational && page.lead_access_status === "verified_by_delivery" ? (
                        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-content-secondary">
                          Acesso a leads confirmado por uma entrega recebida pelo MyChatCRM.
                        </div>
                      ) : null}
                      {page.forms.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-content-secondary">
                            Formulários detectados
                          </p>
                          {page.forms.map((form) => (
                            <div
                              key={form.form_id}
                              className="flex items-center justify-between gap-3 rounded-md border border-line/40 px-3 py-2"
                            >
                              <span className="min-w-0 flex-1 truncate text-xs text-content" title={form.form_name ?? form.form_id}>
                                {form.form_name ?? form.form_id}
                              </span>
                              <span className="text-[11px] text-content-muted">
                                {form.has_active_rule ? "Com regra ativa" : "Sem regra"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : pageReady ? (
                        <p className="text-xs text-content-muted">
                          Nenhum formulário ativo foi encontrado nesta Página.
                        </p>
                      ) : null}
                    </div>
                  </details>
                );
              })}

              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href="/api/meta/connect"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-elevated px-4 py-2 text-sm font-semibold text-content transition-colors hover:border-primary/40"
                  title="Reabre a seleção de páginas do Facebook — use pra adicionar/remover páginas ou gerar um token novo, sem desconectar."
                >
                  <ExternalLink className="size-4" aria-hidden />
                  Reconectar / Editar páginas
                </a>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => void repairMeta()}
                  isLoading={metaRepairing}
                  disabled={metaRepairing}
                >
                  <BadgeCheck className="size-4" aria-hidden />
                  Verificar e reparar
                </Button>
                <a
                  href="/api/meta/connect"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-elevated px-4 py-2 text-sm font-semibold text-content transition-colors hover:border-primary/40"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  Reconectar Meta
                </a>
                <a
                  href="/dashboard/integracoes-leads"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
                >
                  Configurar distribuição
                </a>
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
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Seleção segura das Páginas pelo Facebook Login for Business</li>
                <li className="flex items-center gap-1.5"><Check className="size-3 shrink-0 text-primary" aria-hidden />Permissões, token e assinatura leadgen verificados antes de ativar</li>
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

      <ExternalApiConnectorsPanel />

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
