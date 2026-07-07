"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  History,
  Smartphone,
  QrCode,
  Cloud,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Clock,
  Send,
  RotateCcw,
  Activity,
  Link2,
  GitMerge,
  ChevronDown,
} from "lucide-react";
import { EvolutionQrSlotPanel } from "@/components/dashboard/integrations/EvolutionQrSlotPanel";
import { LiveConversationsPanel } from "@/components/admin/system-agent/LiveConversationsPanel";
import { NotificationsModal } from "@/components/admin/system-agent/NotificationsModal";
import { loadFbSdk } from "@/lib/client/facebook-sdk";
import {
  humanizeNotificationError,
  notificationProvider,
  notificationProviderBadge,
} from "@/lib/client/system-agent-notifications";
import { cn } from "@/lib/utils";

type MetaConfig = {
  active: boolean;
  phone_number_id: string | null;
  display_phone: string | null;
  verified_name: string | null;
  webhook_subscribed?: boolean | null;
  phone_registered?: boolean | null;
  template_name?: string | null;
  template_lang?: string | null;
};

export type SystemNotificationLogItem = {
  id: string;
  type: string;
  to_number: string;
  message: string;
  status: string;
  error: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type DiagnoseResult = {
  instanceName: string | null;
  session: {
    connectionState: string;
    ownerJid: string | null;
    profileName: string | null;
    authenticated: boolean;
    source: string;
  };
  instanceInfo: { connectionStatus: string | null; ownerJid: string | null; profileName: string | null } | null;
  fetchInstancesOk: boolean;
  fetchInstancesError: string | null;
  infrastructure?: {
    evolutionReachable: boolean;
    evolutionPingError: string | null;
    webhookSecretConfigured: boolean;
    expectedWebhookUrl: string | null;
    publicBaseUrl: string | null;
  };
  delivery?: {
    lastDeliveredAt: string | null;
    recentPendingCount: number;
    lastPlatformOutboundAt?: string | null;
    platformOutboundPossiblyBroken?: boolean;
    whatsappNumberCheck?: Array<{ number: string; exists: boolean; jid: string | null; jidAlt: string | null }>;
    webhookUpdatesWorking: boolean;
    pendingOrphanEventsCount?: number;
    lastOrphanReconcileAt?: string | null;
    lastOrphanReconcileApplied?: number | null;
    lastOrphanReconcileRemaining?: number | null;
    webhookBottleneck?: boolean;
  };
  webhook?: {
    lastMessagesUpdateAt: string | null;
    lastMessagesUpdateMessageId: string | null;
    lastMessagesUpdateStatus: unknown;
    lastMessagesUpdateInstance: string | null;
    pendingOrphanEventsCount?: number;
    lastOrphanReconcileAt?: string | null;
    lastOrphanReconcileApplied?: number | null;
    lastOrphanReconcileRemaining?: number | null;
  };
  webhookReapply?: {
    ok: boolean;
    error: string | null;
    url: string;
  };
  recent: Array<{
    type: string;
    status: string;
    to_number: string;
    response_status: unknown;
    message_id: unknown;
    delivered_at: unknown;
    created_at: string;
  }>;
};

function formatWaJid(jid: string | null): string {
  if (!jid) return "—";
  const digits = jid.split("@")[0]?.replace(/\D/g, "");
  return digits ? `+${digits}` : jid;
}

function connectionLabel(state: string): { label: string; tone: string } {
  if (state === "open") return { label: "Conectado", tone: "text-emerald-400" };
  if (state === "connecting") return { label: "A conectar…", tone: "text-amber-400" };
  if (state === "none") return { label: "Não configurado", tone: "text-content-muted" };
  return { label: "Desconectado", tone: "text-rose-400" };
}

function notificationStatusLabel(status: string): { label: string; tone: string } {
  // Honesto: VERDE só quando o WhatsApp confirma a entrega no aparelho (delivered).
  // "enviado/enviando" = a Evolution aceitou, mas a entrega ainda NÃO foi confirmada
  // (amarelo) — não afirmamos "funcionou" sem confirmação real.
  if (status === "delivered") return { label: "entregue ✓ (confirmado no aparelho)", tone: "text-emerald-400" };
  if (status === "sent") return { label: "enviado · aguardando confirmação de entrega", tone: "text-amber-400" };
  if (status === "pending") return { label: "enviando…", tone: "text-amber-400" };
  if (status === "delivery_failed") {
    return { label: "não entregue no celular", tone: "text-rose-400" };
  }
  if (status === "skipped") {
    return { label: "não enviado — sem telefone de alertas", tone: "text-amber-400" };
  }
  return { label: status, tone: "text-rose-400" };
}

const E2E_REQUIRED_FLOWS = [
  {
    type: "admin_test",
    label: "Teste de envio",
    hint: "Confirma que o agente consegue mandar uma mensagem e ela chega no celular.",
  },
  {
    type: "phone_verification_code",
    label: "Código de verificação",
    hint: "Código que o cliente recebe ao confirmar o telefone na conta.",
  },
  {
    type: "handoff_alert",
    label: "Aviso de atendimento humano",
    hint: "Alerta enviado quando uma conversa precisa de um humano.",
  },
  {
    type: "integration_disconnected",
    label: "Aviso de WhatsApp desconectado",
    hint: "Avisa o dono da conta quando o WhatsApp dele cai.",
  },
  {
    type: "account_phone_removed",
    label: "Aviso de telefone removido",
    hint: "Avisa quando um telefone é removido da conta.",
  },
] as const;

function evaluateE2EFlow(logs: SystemNotificationLogItem[], type: string): "pass" | "fail" | "pending" | "none" {
  const latest = logs.find((item) => item.type === type);
  if (!latest) return "none";
  // PASS só com confirmação real de entrega no aparelho (delivered via webhook).
  // "sent/pending" = enviado mas ainda não confirmado → fica pendente (não verde).
  if (latest.status === "delivered") return "pass";
  if (latest.status === "delivery_failed" || latest.status === "failed") return "fail";
  return "pending";
}

function formatLogMetadata(item: SystemNotificationLogItem): string | null {
  const meta = item.metadata;
  if (!meta || typeof meta !== "object") return null;

  const parts: string[] = [];
  const tenantId = typeof meta.tenant_id === "string" ? meta.tenant_id : null;
  const recipientSource = typeof meta.recipient_source === "string" ? meta.recipient_source : null;

  if (item.type === "integration_disconnected") {
    if (tenantId) parts.push(`tenant: ${tenantId}`);
    if (recipientSource) parts.push(`destino: ${recipientSource}`);
  }

  return parts.length ? parts.join(" · ") : null;
}

export function SystemAgentHub(props: {
  agentId: string;
  tenantId: string;
  instanceName: string | null;
  connectionState: string;
  waJid: string | null;
  initialLogs: SystemNotificationLogItem[];
  initialMetaConfig?: MetaConfig | null;
}) {
  const [logs, setLogs] = useState(props.initialLogs);
  const [connectionState, setConnectionState] = useState(props.connectionState);
  const [waJid, setWaJid] = useState(props.waJid);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [webhookReapplyBusy, setWebhookReapplyBusy] = useState(false);
  const [orphanReconcileBusy, setOrphanReconcileBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [qrPanelRevision, setQrPanelRevision] = useState(0);
  const [seedQrDataUrl, setSeedQrDataUrl] = useState<string | null>(null);
  const [metaConfig, setMetaConfig] = useState<MetaConfig | null>(props.initialMetaConfig ?? null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaEmbeddedBusy, setMetaEmbeddedBusy] = useState(false);
  const [metaRepairBusy, setMetaRepairBusy] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [templateLangInput, setTemplateLangInput] = useState("pt_BR");
  const [templateSaveBusy, setTemplateSaveBusy] = useState(false);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  // Pre-loaded FB SDK config so FB.login() can be called synchronously on click
  const metaSdkConfigRef = useRef<{ app_id: string; config_id: string } | null>(null);
  const metaSdkErrorRef = useRef<string | null>(null);
  const conn = connectionLabel(connectionState);
  const metaActive = metaConfig?.active === true;
  const metaConfigured = Boolean(metaConfig?.phone_number_id);
  const senderLine = formatWaJid(waJid);
  // Sessão "open" sem número conectado = sessão zumbi (API aceita, WhatsApp não entrega).
  const zombieSession = connectionState === "open" && (authenticated === false || (!waJid && authenticated !== null));

  const refreshLogs = useCallback(async () => {
    const res = await fetch("/api/admin/system-agent/notifications", { credentials: "same-origin" });
    if (!res.ok) return;
    const json = (await res.json()) as { items?: SystemNotificationLogItem[] };
    setLogs(json.items ?? []);
  }, []);

  const refreshIdentity = useCallback(async () => {
    const res = await fetch("/api/admin/system-agent/evolution/session?slotIndex=0", {
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      connectionState?: string;
      waJid?: string | null;
      authenticated?: boolean;
    };
    if (typeof json.connectionState === "string" && json.connectionState.trim()) {
      setConnectionState(json.connectionState.trim());
    }
    setWaJid(json.waJid ?? null);
    if (typeof json.authenticated === "boolean") setAuthenticated(json.authenticated);
  }, []);

  const setActiveProvider = useCallback(
    async (provider: "evolution" | "meta") => {
      if (provider === "meta" && !metaConfigured) {
        setMetaError("Conecte as credenciais da API Meta antes de ativá-la.");
        return;
      }
      setMetaBusy(true);
      setMetaError(null);
      try {
        const res = await fetch("/api/admin/system-agent/meta/config", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_provider: provider }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          setMetaError(json.error ?? "Falha ao alternar provedor.");
          return;
        }
        setMetaConfig((prev) => (prev ? { ...prev, active: provider === "meta" } : prev));
      } finally {
        setMetaBusy(false);
      }
    },
    [metaConfigured],
  );

  const runDiagnose = useCallback(async () => {
    setDiagnoseBusy(true);
    setActionMessage(null);
    try {
      const qs = testNumber.trim() ? `?testNumber=${encodeURIComponent(testNumber.replace(/\D/g, ""))}` : "";
      const res = await fetch(`/api/admin/system-agent/evolution/diagnose${qs}`, { credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as (DiagnoseResult & { error?: string }) | null;
      if (!res.ok || !json || json.error || !json.session) {
        setActionMessage(json?.error || "Falha ao executar diagnóstico.");
        return;
      }
      setDiagnose(json);
      if (typeof json.session.authenticated === "boolean") setAuthenticated(json.session.authenticated);
      if (json.session.ownerJid) setWaJid(json.session.ownerJid);
      if (json.session.connectionState) setConnectionState(json.session.connectionState);
    } finally {
      setDiagnoseBusy(false);
    }
  }, [testNumber]);

  const repairSession = useCallback(async () => {
    setRepairBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/evolution/diagnose", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair_session" }),
      });
      const json = (await res.json().catch(() => null)) as (DiagnoseResult & {
        error?: string;
        repair?: { ok: boolean; error: string | null; webhookReapplied: boolean };
      }) | null;
      if (!res.ok || !json || json.error || !json.session) {
        setActionMessage(json?.error || "Falha ao reparar sessão.");
        return;
      }
      setDiagnose(json);
      if (json.repair?.ok) {
        setActionMessage(
          "Sessão reiniciada na Evolution (settings + restart + webhook). Aguarde ~10s e teste de novo.",
        );
      } else {
        setActionMessage(json.repair?.error ?? "Falha ao reiniciar sessão na Evolution.");
      }
    } finally {
      setRepairBusy(false);
    }
  }, []);

  const reapplyWebhook = useCallback(async () => {
    setWebhookReapplyBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/evolution/diagnose", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reapply_webhook" }),
      });
      const json = (await res.json().catch(() => null)) as (DiagnoseResult & {
        error?: string;
        webhookReapply?: { ok: boolean; error: string | null; url: string };
      }) | null;
      if (!res.ok || !json || json.error || !json.session) {
        setActionMessage(json?.error || "Falha ao re-aplicar webhook.");
        return;
      }
      setDiagnose(json);
      if (json.webhookReapply?.ok) {
        setActionMessage(`Webhook re-aplicado na instância: ${json.webhookReapply.url}`);
      } else {
        setActionMessage(json.webhookReapply?.error ?? "Falha ao re-aplicar webhook na Evolution.");
      }
    } finally {
      setWebhookReapplyBusy(false);
    }
  }, []);

  const reconcileOrphans = useCallback(async () => {
    setOrphanReconcileBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/evolution/diagnose", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_orphans" }),
      });
      const json = (await res.json().catch(() => null)) as (DiagnoseResult & {
        error?: string;
        reconcile?: { orphansApplied: number; orphansRemaining: number; timedOut: number };
      }) | null;
      if (!res.ok || !json || json.error || !json.session) {
        setActionMessage(json?.error || "Falha ao reconciliar eventos órfãos.");
        return;
      }
      setDiagnose(json);
      void refreshLogs();
      const r = json.reconcile;
      setActionMessage(
        r
          ? `Reconciliação: ${r.orphansApplied} órfão(s) aplicado(s), ${r.orphansRemaining} pendente(s), ${r.timedOut} timeout(s).`
          : "Reconciliação concluída.",
      );
    } finally {
      setOrphanReconcileBusy(false);
    }
  }, [refreshLogs]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshLogs();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refreshLogs]);

  useEffect(() => {
    void refreshIdentity();
    const timer = setInterval(() => {
      void refreshIdentity();
    }, 15_000);
    return () => clearInterval(timer);
  }, [refreshIdentity]);

  const refreshMetaConfig = useCallback(async () => {
    const res = await fetch("/api/admin/system-agent/meta/config", { credentials: "same-origin" });
    if (!res.ok) return;
    const json = (await res.json()) as MetaConfig & { error?: string };
    if (!json.error) setMetaConfig(json);
  }, []);

  useEffect(() => {
    void refreshMetaConfig();
  }, [refreshMetaConfig]);

  // Mantém os inputs do template em sincronia com o que está salvo no servidor.
  useEffect(() => {
    if (typeof metaConfig?.template_name === "string") setTemplateNameInput(metaConfig.template_name);
    if (typeof metaConfig?.template_lang === "string" && metaConfig.template_lang) {
      setTemplateLangInput(metaConfig.template_lang);
    }
  }, [metaConfig?.template_name, metaConfig?.template_lang]);

  // Pre-load the FB SDK as soon as we know Meta isn't connected yet, so
  // FB.login() can be called synchronously within the click gesture later.
  useEffect(() => {
    if (metaConfigured) return;
    if (metaSdkConfigRef.current) return;
    void (async () => {
      try {
        const res = await fetch("/api/admin/system-agent/meta/sdk-config", { credentials: "same-origin" });
        if (!res.ok) {
          metaSdkErrorRef.current = `sdk-config ${res.status}`;
          return;
        }
        const cfg = (await res.json()) as { app_id: string; config_id: string };
        await loadFbSdk(cfg.app_id);
        metaSdkConfigRef.current = cfg;
        metaSdkErrorRef.current = null;
      } catch (err) {
        metaSdkErrorRef.current = err instanceof Error ? err.message : String(err);
      }
    })();
  }, [metaConfigured]);

  // FB.login() must be called synchronously within the user-gesture context —
  // no awaits before it. Mirrors connectWaCloud in IntegracoesHub.tsx.
  const connectMetaEmbedded = useCallback(() => {
    const cfg = metaSdkConfigRef.current;
    if (!window.FB || !cfg) {
      const reason = metaSdkErrorRef.current;
      setMetaError(
        reason
          ? `Não foi possível carregar o SDK da Meta (${reason}). Recarregue a página e tente novamente.`
          : "SDK Meta ainda carregando. Aguarde um instante e tente novamente.",
      );
      return;
    }

    setMetaEmbeddedBusy(true);
    setMetaError(null);

    let wabaId: string | null = null;
    let phoneNumberId: string | null = null;
    let callbackFired = false;

    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !event.origin.endsWith("facebook.com")) return;
      try {
        const data = (typeof event.data === "string" ? JSON.parse(event.data) : event.data) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string };
        } | null;
        if (!data || data.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
          wabaId = data.data?.waba_id ?? null;
          phoneNumberId = data.data?.phone_number_id ?? null;
        } else if (data.event === "CANCEL" || data.event === "ERROR") {
          console.warn("[wa-embedded-signup/admin]", data.event, data.data);
        }
      } catch {
        // postMessage from unrelated facebook widgets — ignore
      }
    };

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
    };

    const safetyTimer = setTimeout(() => {
      if (!callbackFired) {
        cleanup();
        setMetaError("O popup do Facebook não respondeu. Permita popups para este site e tente novamente.");
        setMetaEmbeddedBusy(false);
      }
    }, 120_000);

    window.addEventListener("message", onMessage);

    try {
      window.FB.login(
        (response) => {
          callbackFired = true;
          clearTimeout(safetyTimer);
          void (async () => {
            if (!response.authResponse?.code) {
              cleanup();
              setMetaError("Conexão cancelada ou não autorizada.");
              setMetaEmbeddedBusy(false);
              return;
            }

            for (let i = 0; i < 30 && (!wabaId || !phoneNumberId); i++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            cleanup();

            if (!wabaId || !phoneNumberId) {
              setMetaError("Nenhum número WhatsApp Business encontrado. Tente novamente.");
              setMetaEmbeddedBusy(false);
              return;
            }

            try {
              const exchRes = await fetch("/api/admin/system-agent/meta/exchange-code", {
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
                webhook_subscribed?: boolean;
                phone_registered?: boolean;
              };
              if (exchData.connected && exchData.phone_number_id) {
                setMetaConfig({
                  active: true,
                  phone_number_id: exchData.phone_number_id,
                  display_phone: exchData.display_phone ?? null,
                  verified_name: exchData.verified_name ?? null,
                  webhook_subscribed: exchData.webhook_subscribed ?? null,
                  phone_registered: exchData.phone_registered ?? null,
                });
                if (exchData.webhook_subscribed === false || exchData.phone_registered === false) {
                  setMetaError(
                    "Conectado, mas o onboarding não completou (webhook/registro). Clique em «Reparar conexão Meta» abaixo.",
                  );
                }
              } else {
                setMetaError("Erro ao salvar conexão. Tente novamente.");
              }
            } catch {
              setMetaError("Erro de rede ao salvar conexão. Tente novamente.");
            } finally {
              setMetaEmbeddedBusy(false);
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
      clearTimeout(safetyTimer);
      cleanup();
      const msg = err instanceof Error ? err.message : String(err);
      setMetaError(`Erro ao iniciar conexão Meta: ${msg}. Tente novamente.`);
      console.error("[connectMetaEmbedded]", msg);
      setMetaEmbeddedBusy(false);
    }
  }, []);

  const disconnectMeta = useCallback(async () => {
    setMetaBusy(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/admin/system-agent/meta/config", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.ok) {
        setMetaConfig({ active: false, phone_number_id: null, display_phone: null, verified_name: null });
      }
    } finally {
      setMetaBusy(false);
    }
  }, []);

  // Reexecuta subscribed_apps + register com as credenciais salvas — repara
  // webhook não inscrito ou número não registrado sem reconectar do zero.
  const repairMeta = useCallback(async () => {
    setMetaRepairBusy(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/admin/system-agent/meta/repair", {
        method: "POST",
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        webhook_subscribed?: boolean;
        phone_registered?: boolean;
      };
      if (!res.ok) {
        setMetaError(json.error ?? "Falha ao reparar conexão Meta.");
        return;
      }
      setMetaConfig((prev) =>
        prev
          ? {
              ...prev,
              webhook_subscribed: json.webhook_subscribed ?? prev.webhook_subscribed,
              phone_registered: json.phone_registered ?? prev.phone_registered,
            }
          : prev,
      );
      setMetaError(
        json.ok
          ? null
          : `Reparo parcial — webhook: ${json.webhook_subscribed ? "ok" : "falhou"}, registro do número: ${json.phone_registered ? "ok" : "falhou"}.`,
      );
    } finally {
      setMetaRepairBusy(false);
    }
  }, []);

  const saveMetaTemplate = useCallback(async () => {
    setTemplateSaveBusy(true);
    setMetaError(null);
    try {
      const res = await fetch("/api/admin/system-agent/meta/config", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_name: templateNameInput.trim(), template_lang: templateLangInput.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        template_name?: string | null;
        template_lang?: string | null;
      };
      if (!res.ok) {
        setMetaError(json.error ?? "Falha ao salvar template.");
        return;
      }
      setMetaConfig((prev) =>
        prev ? { ...prev, template_name: json.template_name ?? null, template_lang: json.template_lang ?? null } : prev,
      );
    } finally {
      setTemplateSaveBusy(false);
    }
  }, [templateNameInput, templateLangInput]);

  const restartSession = useCallback(async () => {
    setRestartBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/evolution/session", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconnect" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        connectionState?: string;
        qrDataUrl?: string | null;
        detail?: string;
      };
      if (!res.ok) {
        setActionMessage(json.error ?? json.detail ?? "Falha ao forçar reconexão.");
        return;
      }
      if (typeof json.connectionState === "string") setConnectionState(json.connectionState);
      if (json.qrDataUrl) {
        setSeedQrDataUrl(json.qrDataUrl);
        setConnectionState(json.connectionState ?? "close");
        setQrPanelRevision((r) => r + 1);
        setActionMessage(
          `Escaneie o QR com o número NOVO. Instâncias antigas do sistema foram removidas da Evolution. Sem QR, o WhatsApp não entrega.`,
        );
      } else {
        setActionMessage("Sessão reiniciada. Se ainda não receber, desconecte e escaneie o QR novamente.");
      }
      await refreshIdentity();
    } finally {
      setRestartBusy(false);
    }
  }, [refreshIdentity, senderLine]);

  const sendTest = useCallback(async () => {
    if (!testNumber.trim()) {
      setActionMessage("Informe o número de destino para o teste.");
      return;
    }
    setTestBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/test-send", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber: testNumber.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        deliveryStatus?: string;
        deliveryError?: string | null;
        debug?: {
          numberSent?: string;
          candidatesTried?: string[];
          evolutionResponseStatus?: unknown;
          sessionOwnerJid?: string | null;
        };
      };
      // Com Meta ativa, sessionOwnerJid/waJid são da Evolution (irrelevantes aqui)
      // — o remetente real é o número Meta salvo.
      const sender = metaActive
        ? null
        : (json.debug?.sessionOwnerJid?.split("@")[0]?.replace(/\D/g, "") ?? waJid?.split("@")[0]?.replace(/\D/g, ""));
      const senderLabel = metaActive ? (metaConfig?.display_phone ?? "API Meta") : sender ? `+${sender}` : senderLine;
      const tried = json.debug?.candidatesTried?.join(", ") ?? json.debug?.numberSent ?? testNumber.trim();

      if (!res.ok) {
        // ⚠️ Não confirmado (preso em PENDING) tem mensagem própria via humanize;
        // demais erros (sessão caída, número inválido) caem no fallback ❌.
        // provider explícito: sem isso, cai no texto de Evolution mesmo quando
        // o teste rodou pela API Meta.
        setActionMessage(
          humanizeNotificationError(json.error ?? json.deliveryError ?? null, metaActive ? "meta_cloud" : null) ??
            json.error ??
            "❌ Falha no envio de teste.",
        );
        await refreshLogs();
        return;
      }

      if (json.deliveryStatus === "delivered") {
        setActionMessage(`✅ Entregue e confirmado no aparelho — enviado de ${senderLabel} para ${tried}.`);
      } else if (json.deliveryStatus === "sent") {
        // SERVER_ACK: o WhatsApp aceitou e a mensagem SAIU de verdade — o número
        // funciona. A confirmação de entrega no aparelho pode chegar logo depois.
        setActionMessage(
          `✅ Enviado e aceito pelo WhatsApp (SERVER_ACK) de ${senderLabel} para ${tried} — este número está entregando. Aguardando confirmação de leitura no aparelho.`,
        );
      } else {
        setActionMessage(
          `Disparado de ${senderLabel} para ${tried}. Aguardando confirmação do WhatsApp…`,
        );
      }
      await refreshLogs();
    } finally {
      setTestBusy(false);
    }
  }, [refreshLogs, senderLine, testNumber, metaActive, metaConfig?.display_phone, waJid]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-card text-primary">
            <Bot className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-content">Agente do Sistema MyChatCRM</h1>
            <p className="text-sm text-content-muted">
              Infraestrutura interna para notificações WhatsApp do SaaS (handoff, alertas, leads, cobrança).
            </p>
          </div>
        </div>
      </header>

      {/* Status amigável */}
      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line/60 bg-surface-elevated/30 p-3">
            <p className="text-[11px] uppercase tracking-wide text-content-faint">Conexão</p>
            {/* O card reflete o canal ATIVO: com Meta ligada, o estado da Evolution é irrelevante aqui. */}
            {metaActive ? (
              <p
                className={cn(
                  "mt-1 flex items-center gap-1.5 text-sm font-semibold",
                  metaConfigured ? "text-emerald-400" : "text-rose-400",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", metaConfigured ? "bg-emerald-400" : "bg-rose-400")} />
                {metaConfigured ? "Conectado · API Meta" : "Sem credenciais Meta"}
              </p>
            ) : (
              <p className={cn("mt-1 flex items-center gap-1.5 text-sm font-semibold", conn.tone)}>
                <span className={cn("h-2 w-2 rounded-full", connectionState === "open" ? "bg-emerald-400" : connectionState === "connecting" ? "bg-amber-400" : "bg-rose-400")} />
                {conn.label}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-line/60 bg-surface-elevated/30 p-3">
            <p className="text-[11px] uppercase tracking-wide text-content-faint">Número que atende</p>
            <p className="mt-1 font-mono text-sm text-content-secondary">{metaActive ? (metaConfig?.display_phone ?? "API Meta") : formatWaJid(waJid)}</p>
          </div>
          <div className="rounded-lg border border-line/60 bg-surface-elevated/30 p-3">
            <p className="text-[11px] uppercase tracking-wide text-content-faint">Método de envio</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-content-secondary">
              {metaActive ? <Cloud className="h-3.5 w-3.5 text-primary" /> : <QrCode className="h-3.5 w-3.5 text-primary" />}
              {metaActive ? "API Oficial Meta" : "QR Code (Evolution)"}
            </p>
          </div>
        </div>

        {!metaActive && zombieSession ? (
          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-3 text-xs leading-relaxed text-rose-100">
            <strong>Sessão sem número ativo.</strong> O status diz &quot;Conectado&quot;, mas não há um número WhatsApp
            de verdade na sessão — a Evolution aceita os envios, porém o WhatsApp não entrega.{" "}
            <strong>Solução:</strong> em &quot;Método de envio&quot;, desconecte e reconecte escaneando o QR.
          </div>
        ) : null}
        {!metaActive && senderLine !== "—" ? (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            As notificações saem do número <strong>{senderLine}</strong>. No celular, procure essa conversa (ou em
            Solicitações) — não confunda com o WhatsApp comercial do seu tenant.
          </p>
        ) : null}

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-content-faint hover:text-content-secondary">Detalhes técnicos</summary>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-content-faint">Agent ID</dt>
              <dd className="font-mono text-content-secondary">{props.agentId}</dd>
            </div>
            <div>
              <dt className="text-content-faint">Tenant interno</dt>
              <dd className="font-mono text-content-secondary">{props.tenantId}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-content-faint">Instância Evolution</dt>
              <dd className="break-all font-mono text-content-secondary">{props.instanceName ?? "—"}</dd>
            </div>
          </dl>
        </details>
      </section>

      {/* Método de envio com chave de provedor */}
      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
            Método de envio WhatsApp
          </h2>
        </div>

        {/* Chave de seleção do provedor */}
        <div className="mb-4 rounded-lg border border-line/60 bg-surface-elevated/30 p-4">
          <div className="mb-3">
            <p className="text-xs font-semibold text-content">Qual número atende as conversas automaticamente?</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-content-faint">
              Só o método marcado como <strong className="text-emerald-400">ativo</strong> responde às mensagens.
              Trocar aqui não desconecta o outro — ele continua salvo, só fica em espera.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={metaBusy}
              onClick={() => void setActiveProvider("evolution")}
              className={cn(
                "flex flex-1 items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition-colors disabled:opacity-60",
                !metaActive
                  ? "border-primary bg-primary/10"
                  : "border-line/40 bg-surface-card hover:border-line",
              )}
            >
              <QrCode className={cn("h-4 w-4 shrink-0", !metaActive ? "text-primary" : "text-content-faint")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-content">QR Code (Evolution)</span>
                <span className="block text-[10px] text-content-faint">
                  {!metaActive
                    ? "Atendendo agora"
                    : connectionState === "open"
                      ? "Conectado, em espera"
                      : "Desconectado"}
                </span>
              </span>
              {!metaActive ? (
                <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  ativo
                </span>
              ) : null}
            </button>
            <button
              type="button"
              disabled={metaBusy || !metaConfigured}
              title={!metaConfigured ? "Conecte a API Meta primeiro" : undefined}
              onClick={() => void setActiveProvider("meta")}
              className={cn(
                "flex flex-1 items-center gap-2.5 rounded-lg border-2 px-3 py-2.5 text-left transition-colors disabled:opacity-40",
                metaActive
                  ? "border-primary bg-primary/10"
                  : "border-line/40 bg-surface-card hover:border-line",
              )}
            >
              <Cloud className={cn("h-4 w-4 shrink-0", metaActive ? "text-primary" : "text-content-faint")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-content">API Meta</span>
                <span className="block text-[10px] text-content-faint">
                  {!metaConfigured ? "Não conectado" : metaActive ? "Atendendo agora" : "Conectado, em espera"}
                </span>
              </span>
              {metaActive ? (
                <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  ativo
                </span>
              ) : null}
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Card QR Scan (Evolution) */}
          <div
            className={cn(
              "rounded-lg border p-4 transition-opacity",
              metaActive ? "border-line/40 bg-surface-elevated/20 opacity-60" : "border-primary/30 bg-primary/5",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-content-secondary">
                <QrCode className="h-3.5 w-3.5" /> QR Code (Evolution)
              </span>
              {metaActive ? (
                <span className="rounded-full bg-content-faint/10 px-2 py-0.5 text-[10px] font-medium text-content-faint">
                  inativo
                </span>
              ) : (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  ativo
                </span>
              )}
            </div>
            {metaActive ? (
              <p className="text-xs text-content-muted">
                Para usar o QR Code, mude a chave acima para &quot;QR Code&quot;.
              </p>
            ) : (
              <EvolutionQrSlotPanel
                key={`system-agent-qr-${qrPanelRevision}`}
                slotIndex={0}
                sessionApiPath="/api/admin/system-agent/evolution/session"
                statusApiPath="/api/admin/system-agent/evolution/status"
                autoProvision={false}
                strictVerifiedRemoval
                seedQrDataUrl={seedQrDataUrl}
              />
            )}
          </div>

          {/* Card API Oficial Meta */}
          <div
            className={cn(
              "rounded-lg border p-4 transition-opacity",
              metaActive ? "border-primary/30 bg-primary/5" : "border-line/40 bg-surface-elevated/20",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-content-secondary">
                <Cloud className="h-3.5 w-3.5" /> API Oficial Meta
              </span>
              {metaActive ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  ativo
                </span>
              ) : metaConfigured ? (
                <span className="rounded-full bg-content-faint/10 px-2 py-0.5 text-[10px] font-medium text-content-faint">
                  conectado · inativo
                </span>
              ) : (
                <span className="rounded-full bg-content-faint/10 px-2 py-0.5 text-[10px] font-medium text-content-faint">
                  não conectado
                </span>
              )}
            </div>

            {metaConfigured ? (
              <div className="space-y-3">
                <dl className="grid gap-1.5 text-xs">
                  <div>
                    <dt className="text-content-faint">Número</dt>
                    <dd className="font-mono text-content-secondary">
                      {metaConfig?.display_phone ?? metaConfig?.phone_number_id ?? "—"}
                    </dd>
                  </div>
                  {metaConfig?.verified_name ? (
                    <div>
                      <dt className="text-content-faint">Nome verificado</dt>
                      <dd className="text-content-secondary">{metaConfig.verified_name}</dd>
                    </div>
                  ) : null}
                </dl>

                {/* Saúde do onboarding (webhook + registro) — null = conexão antiga, estado desconhecido */}
                {metaConfig?.webhook_subscribed === false || metaConfig?.phone_registered === false ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                    {metaConfig?.webhook_subscribed === false ? (
                      <p>
                        ⚠ <strong>Webhook não inscrito</strong> — mensagens recebidas e confirmações de entrega não
                        chegarão.
                      </p>
                    ) : null}
                    {metaConfig?.phone_registered === false ? (
                      <p>
                        ⚠ <strong>Número não registrado na Cloud API</strong> — envios podem falhar.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Template para mensagens iniciadas pela empresa (fora da janela de 24h) */}
                <div className="rounded-lg border border-line/50 bg-surface-elevated/20 p-2.5">
                  <p className="text-[11px] font-semibold text-content-secondary">Template de notificações (opcional)</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-content-faint">
                    Necessário para a Meta entregar mensagens iniciadas pela empresa fora da janela de 24h. Crie um
                    template utilitário com <span className="font-mono">{"{{1}}"}</span> no corpo, no gerenciador do
                    WhatsApp, e informe o nome aqui.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={templateNameInput}
                      onChange={(e) => setTemplateNameInput(e.target.value)}
                      placeholder="ex.: system_notification"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-surface-elevated px-2.5 py-1.5 text-xs text-content"
                    />
                    <input
                      type="text"
                      value={templateLangInput}
                      onChange={(e) => setTemplateLangInput(e.target.value)}
                      placeholder="pt_BR"
                      className="w-20 rounded-lg border border-line bg-surface-elevated px-2.5 py-1.5 text-xs text-content"
                    />
                    <button
                      type="button"
                      disabled={templateSaveBusy}
                      onClick={() => void saveMetaTemplate()}
                      className="rounded-lg bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-content-secondary border border-line disabled:opacity-60"
                    >
                      {templateSaveBusy ? "Salvando…" : "Salvar"}
                    </button>
                  </div>
                  {metaConfig?.template_name ? (
                    <p className="mt-1.5 text-[10px] text-emerald-400">
                      ✓ Notificações serão enviadas via template «{metaConfig.template_name}» (
                      {metaConfig.template_lang ?? "pt_BR"}).
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-content-faint">
                      Sem template: envio em texto livre — só entrega se o destinatário mandou mensagem nas últimas
                      24h.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={metaRepairBusy}
                    onClick={() => void repairMeta()}
                    className="rounded-lg border border-line bg-surface-elevated px-3 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-elevated/60 disabled:opacity-60"
                  >
                    {metaRepairBusy ? "Reparando…" : "Reparar conexão Meta"}
                  </button>
                  <button
                    type="button"
                    disabled={metaBusy}
                    onClick={() => void disconnectMeta()}
                    className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                  >
                    {metaBusy ? "Removendo…" : "Remover credenciais Meta"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-content-muted">
                  Para números WhatsApp Business registrados na Meta Cloud API (ex.:{" "}
                  <span className="font-mono">556282067910</span>).
                </p>
                <button
                  type="button"
                  disabled={metaEmbeddedBusy}
                  onClick={() => connectMetaEmbedded()}
                  className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                >
                  {metaEmbeddedBusy ? "Conectando…" : "Conectar via Facebook"}
                </button>
              </div>
            )}
            {metaError ? <p className="mt-2 text-xs text-rose-300">{metaError}</p> : null}
          </div>
        </div>
      </section>

      {/* Conversas ao vivo (somente leitura) */}
      <LiveConversationsPanel systemTenantId={props.tenantId} />

      {/* Diagnóstico e manutenção */}
      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <div className="mb-5 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
            Diagnóstico e manutenção
          </h2>
        </div>

        {/* Verificar entrega — ação principal (hero) */}
        <div className="rounded-xl border border-line/70 bg-gradient-to-b from-surface-elevated/40 to-surface-elevated/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Send className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-xs font-semibold text-content">Verificar entrega</p>
              <p className="text-[11px] text-content-faint">Envie uma mensagem de teste e veja se chega no aparelho.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="tel"
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              placeholder="62993580574"
              className="flex-1 rounded-lg border border-line bg-surface-card px-3 py-2.5 text-sm text-content placeholder:text-content-faint focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              disabled={testBusy}
              onClick={() => void sendTest()}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {testBusy ? "Enviando…" : "Enviar teste"}
            </button>
          </div>

          {/* Legenda de resultado */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <strong className="font-medium text-emerald-400">entregue</strong>
              <span className="text-content-faint">chegou no aparelho</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/5 px-2.5 py-1 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <strong className="font-medium text-amber-400">enviado</strong>
              <span className="text-content-faint">aceito, aguardando confirmação</span>
            </span>
          </div>

          {actionMessage ? (
            <p className="mt-3 rounded-lg border border-line/60 bg-surface-card px-3 py-2 text-xs leading-relaxed text-content-secondary">
              {actionMessage}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-content-faint">
              {metaActive
                ? "Preso em “enviado”? Fora da janela de 24h a Meta descarta texto livre: peça para o destinatário mandar uma mensagem para o número primeiro, ou configure um template aprovado."
                : "Preso em “enviado”? Reconecte o QR e confirme que o destinatário salvou o número (anti-spam de número novo)."}
            </p>
          )}
        </div>

        {/* Ferramentas de manutenção */}
        <p className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-wider text-content-faint">
          Ferramentas de manutenção
        </p>
        {metaActive ? (
          <div className="mb-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            ⚠ Estas ferramentas são do <strong>QR Code (Evolution)</strong>. O método ativo agora é a API Meta —
            use-as apenas para manutenção da conexão QR.
          </div>
        ) : null}
        <div className={cn("grid grid-cols-1 gap-2.5 sm:grid-cols-2", metaActive ? "opacity-60" : "")}>
          <button
            type="button"
            disabled={restartBusy}
            onClick={() => void restartSession()}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface-elevated/20 p-3 text-left transition-all hover:border-primary/30 hover:bg-surface-elevated/40 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-surface-card text-content-secondary transition-colors group-hover:text-primary">
              <RotateCcw className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-content-secondary">
                {restartBusy ? "Reconectando…" : "Forçar reconexão"}
              </span>
              <span className="block text-[11px] leading-tight text-content-faint">Gera um QR novo para reconectar</span>
            </span>
          </button>

          <button
            type="button"
            disabled={repairBusy}
            onClick={() => void repairSession()}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface-elevated/20 p-3 text-left transition-all hover:border-amber-500/40 hover:bg-amber-500/5 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <Wrench className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-content-secondary">
                {repairBusy ? "Reparando…" : "Reparar sessão"}
              </span>
              <span className="block text-[11px] leading-tight text-content-faint">Reinicia a sessão na VPS</span>
            </span>
          </button>

          <button
            type="button"
            disabled={webhookReapplyBusy}
            onClick={() => void reapplyWebhook()}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface-elevated/20 p-3 text-left transition-all hover:border-primary/30 hover:bg-surface-elevated/40 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-surface-card text-content-secondary transition-colors group-hover:text-primary">
              <Link2 className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-content-secondary">
                {webhookReapplyBusy ? "Aplicando…" : "Re-aplicar webhook"}
              </span>
              <span className="block text-[11px] leading-tight text-content-faint">Reconfigura o webhook na Evolution</span>
            </span>
          </button>

          <button
            type="button"
            disabled={orphanReconcileBusy}
            onClick={() => void reconcileOrphans()}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface-elevated/20 p-3 text-left transition-all hover:border-primary/30 hover:bg-surface-elevated/40 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-surface-card text-content-secondary transition-colors group-hover:text-primary">
              <GitMerge className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-content-secondary">
                {orphanReconcileBusy ? "Reconciliando…" : "Reconciliar órfãos"}
              </span>
              <span className="block text-[11px] leading-tight text-content-faint">Fecha confirmações pendentes</span>
            </span>
          </button>
        </div>

        {/* Diagnóstico avançado */}
        <button
          type="button"
          disabled={diagnoseBusy}
          onClick={() => void runDiagnose()}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-2.5 text-xs font-medium text-content-secondary transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
        >
          <Activity className="h-3.5 w-3.5" />
          {diagnoseBusy ? "Verificando…" : "Diagnóstico avançado"}
        </button>

        {/* Ajuda colapsável */}
        <div className="mt-4 space-y-2">
          <details className="group rounded-xl border border-line/60 bg-surface-elevated/15 px-3.5 py-3 text-xs">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-content-secondary">
              Como usar estes controles (runbook)
              <ChevronDown className="h-4 w-4 text-content-faint transition-transform group-open:rotate-180" />
            </summary>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-content-muted">
              <li><strong>Enviar teste</strong> — confirma que o número consegue entregar.</li>
              <li><strong>Forçar reconexão</strong> — gera QR novo (limpa instâncias antigas).</li>
              <li><strong>Reparar sessão</strong> — reinicia na Evolution quando &quot;Conectado&quot; mas não entrega.</li>
              <li><strong>Re-aplicar webhook</strong> — reconfigura MESSAGES_UPDATE + CONNECTION_UPDATE.</li>
              <li><strong>Reconciliar órfãos</strong> — fecha confirmações que chegaram antes do log.</li>
              <li><strong>Restart VPS</strong> — via SSH: <code className="font-mono">scripts/evolution-vps-maintenance.sh restart</code>.</li>
            </ol>
          </details>

          <details className="group rounded-xl border border-line/60 bg-surface-elevated/15 px-3.5 py-3 text-xs">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-content-secondary">
              Teste de isolamento (Evolution Manager)
              <ChevronDown className="h-4 w-4 text-content-faint transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-3 text-content-muted">
              Para descobrir se o problema é o app ou a VPS, compare o envio direto no Evolution Manager:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-content-muted">
              <li>Instância do <strong>sistema</strong> → envie texto para o número de teste.</li>
              <li>Instância de um <strong>cliente</strong> → mesmo número.</li>
              <li><strong>Enviar teste</strong> aqui no MyChatCRM → compare os três.</li>
            </ol>
            <p className="mt-2 text-[11px] text-content-faint">
              Nenhum entrega → VPS/Baileys. Só cliente entrega → reconecte a sessão do sistema. Manager entrega mas app não → bug de formato no app.
            </p>
          </details>
        </div>
        {diagnose ? (
          <div className="mt-4 space-y-2 rounded-lg border border-line/80 bg-surface-elevated/40 p-3 text-xs">
            <div className="grid gap-1 sm:grid-cols-2">
              <span className="text-content-faint">
                Sessão (fonte: {diagnose.session.source}):{" "}
                <strong className={diagnose.session.authenticated ? "text-emerald-400" : "text-rose-400"}>
                  {diagnose.session.authenticated ? "autenticada" : "NÃO autenticada"}
                </strong>
              </span>
              <span className="text-content-faint">
                connectionStatus: <span className="font-mono text-content-secondary">{diagnose.session.connectionState}</span>
              </span>
              <span className="text-content-faint">
                Número (ownerJid):{" "}
                <span className="font-mono text-content-secondary">{formatWaJid(diagnose.session.ownerJid)}</span>
              </span>
              <span className="text-content-faint">
                Perfil: <span className="text-content-secondary">{diagnose.session.profileName ?? "—"}</span>
              </span>
            </div>
            {!diagnose.fetchInstancesOk ? (
              <p className="text-rose-300">
                Não foi possível ler fetchInstances: {diagnose.fetchInstancesError ?? "erro desconhecido"}
              </p>
            ) : null}
            {diagnose.infrastructure ? (
              <div className="mt-2 space-y-1 border-t border-line/40 pt-2">
                <p className="text-content-faint">
                  Evolution VPS:{" "}
                  <strong className={diagnose.infrastructure.evolutionReachable ? "text-emerald-400" : "text-rose-400"}>
                    {diagnose.infrastructure.evolutionReachable ? "alcançável" : "inacessível"}
                  </strong>
                </p>
                <p className="break-all text-content-faint">
                  Webhook esperado:{" "}
                  <span className="font-mono text-content-secondary">
                    {diagnose.infrastructure.expectedWebhookUrl ?? "EVOLUTION_WEBHOOK_SECRET em falta"}
                  </span>
                </p>
                {diagnose.delivery ? (
                  <>
                    {diagnose.delivery.platformOutboundPossiblyBroken ? (
                      <p className="text-rose-300">
                        <strong>Alerta plataforma:</strong> nenhum envio outbound confirmado no CRM desde{" "}
                        {diagnose.delivery.lastPlatformOutboundAt
                          ? new Date(diagnose.delivery.lastPlatformOutboundAt).toLocaleString("pt-BR")
                          : "sempre"}
                        . Se /conversas também não envia, o problema é a sessão Baileys na VPS — use
                        &quot;Reparar sessão&quot; ou reinicie o container Evolution.
                      </p>
                    ) : null}
                    <p className="text-content-faint">
                      Entregas confirmadas via webhook:{" "}
                      <strong className={diagnose.delivery.webhookUpdatesWorking ? "text-emerald-400" : "text-amber-400"}>
                        {diagnose.delivery.webhookUpdatesWorking
                          ? `sim (última: ${diagnose.delivery.lastDeliveredAt ? new Date(diagnose.delivery.lastDeliveredAt).toLocaleString("pt-BR") : diagnose.webhook?.lastMessagesUpdateAt ? new Date(diagnose.webhook.lastMessagesUpdateAt).toLocaleString("pt-BR") : "—"})`
                          : `nenhuma ainda (${diagnose.delivery.recentPendingCount} pendentes recentes)`}
                      </strong>
                    </p>
                    {(diagnose.delivery.pendingOrphanEventsCount ?? diagnose.webhook?.pendingOrphanEventsCount ?? 0) >
                    0 ? (
                      <p className="text-amber-300">
                        Eventos órfãos pendentes:{" "}
                        <strong>
                          {diagnose.delivery.pendingOrphanEventsCount ??
                            diagnose.webhook?.pendingOrphanEventsCount ??
                            0}
                        </strong>
                        {" · "}
                        Use &quot;Reconciliar órfãos&quot; após envios ou se webhook chegou antes do log.
                      </p>
                    ) : null}
                    {diagnose.delivery.webhookBottleneck ? (
                      <p className="text-amber-300">
                        Gargalo provável: <strong>webhook MESSAGES_UPDATE</strong> (sessão OK, mas confirmação não
                        fecha no log). Re-aplique webhook e reconcilie órfãos.
                      </p>
                    ) : null}
                    {diagnose.delivery.lastOrphanReconcileAt ? (
                      <p className="text-content-faint">
                        Última reconciliação de órfãos:{" "}
                        {new Date(diagnose.delivery.lastOrphanReconcileAt).toLocaleString("pt-BR")}
                        {typeof diagnose.delivery.lastOrphanReconcileApplied === "number"
                          ? ` · aplicados: ${diagnose.delivery.lastOrphanReconcileApplied}`
                          : null}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {diagnose.webhook?.lastMessagesUpdateAt ? (
                  <p className="text-content-faint">
                    Último MESSAGES_UPDATE:{" "}
                    <span className="font-mono text-content-secondary">
                      {new Date(diagnose.webhook.lastMessagesUpdateAt).toLocaleString("pt-BR")}
                    </span>
                    {diagnose.webhook.lastMessagesUpdateMessageId
                      ? ` · ${diagnose.webhook.lastMessagesUpdateMessageId}`
                      : null}
                  </p>
                ) : null}
              </div>
            ) : null}
            {diagnose.recent.length ? (
              <div className="mt-2">
                <p className="mb-1 text-content-faint">Últimos envios (status real):</p>
                <ul className="space-y-1">
                  {diagnose.recent.slice(0, 5).map((r, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2 text-content-muted">
                      <span className="font-mono">{new Date(r.created_at).toLocaleTimeString("pt-BR")}</span>
                      <span>{r.type}</span>
                      <span
                        className={
                          r.status === "delivered"
                            ? "text-emerald-400"
                            : r.status === "pending" || r.status === "sent"
                              ? "text-amber-400"
                              : "text-rose-400"
                        }
                      >
                        {r.status}
                      </span>
                      {r.response_status ? <span>· {String(r.response_status)}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
          Checklist de validação
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Cada item abaixo é um tipo de aviso que o agente do sistema envia. O status mostra se o último envio
          daquele tipo <strong>chegou no celular</strong> (verde), ainda está <strong>aguardando</strong> (âmbar),
          <strong> falhou</strong> (vermelho) ou <strong>nunca foi testado</strong> (cinza).
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {E2E_REQUIRED_FLOWS.map((flow) => {
            const result = evaluateE2EFlow(logs, flow.type);
            const meta =
              result === "pass"
                ? { Icon: CheckCircle2, tone: "text-emerald-400", ring: "border-emerald-500/30 bg-emerald-500/[0.05]", label: "Entregue" }
                : result === "fail"
                  ? { Icon: AlertTriangle, tone: "text-rose-400", ring: "border-rose-500/30 bg-rose-500/[0.05]", label: "Falhou" }
                  : result === "pending"
                    ? { Icon: Clock, tone: "text-amber-400", ring: "border-amber-500/30 bg-amber-500/[0.05]", label: "Aguardando" }
                    : { Icon: Circle, tone: "text-content-muted", ring: "border-line/60", label: "Não testado" };
            const Icon = meta.Icon;
            return (
              <div key={flow.type} className={cn("flex items-start gap-3 rounded-lg border p-3", meta.ring)}>
                <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", meta.tone)} aria-hidden />
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-content">{flow.label}</p>
                    <span className={cn("text-[11px] font-medium", meta.tone)}>{meta.label}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-content-muted">{flow.hint}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
              Últimas notificações
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setNotifModalOpen(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver todas
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhuma notificação registrada ainda.</p>
        ) : (
          <ul className="space-y-3">
            {logs.slice(0, 3).map((item) => {
              const status = notificationStatusLabel(item.status);
              const metaLine = formatLogMetadata(item);
              const provider = notificationProvider(item.metadata);
              const providerBadge = notificationProviderBadge(provider);
              const errorLine = humanizeNotificationError(item.error, provider);

              return (
                <li key={item.id} className="rounded-lg border border-line/80 bg-surface-elevated/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold uppercase tracking-wide text-content-secondary">{item.type}</span>
                      {providerBadge ? (
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", providerBadge.tone)}>
                          {providerBadge.label}
                        </span>
                      ) : null}
                    </span>
                    <span className={status.tone}>{status.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-content-faint">
                    {new Date(item.created_at).toLocaleString("pt-BR")} · {item.to_number}
                  </p>
                  {metaLine ? <p className="mt-1 text-xs text-content-muted">{metaLine}</p> : null}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-content-secondary">{item.message}</p>
                  {errorLine ? <p className="mt-1 text-xs text-rose-300">{errorLine}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        {logs.length > 3 ? (
          <button
            type="button"
            onClick={() => setNotifModalOpen(true)}
            className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-xs font-medium text-content-secondary hover:bg-surface-elevated/40"
          >
            Ver todas as notificações ({logs.length >= 10 ? "10+" : logs.length})
          </button>
        ) : null}
      </section>

      <NotificationsModal
        open={notifModalOpen}
        onClose={() => {
          setNotifModalOpen(false);
          void refreshLogs();
        }}
      />
    </div>
  );
}
