"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, History, Smartphone } from "lucide-react";
import { EvolutionQrSlotPanel } from "@/components/dashboard/integrations/EvolutionQrSlotPanel";
import { cn } from "@/lib/utils";

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
  { type: "admin_test", label: "Teste admin" },
  { type: "phone_verification_code", label: "Código de verificação" },
  { type: "handoff_alert", label: "Handoff" },
  { type: "integration_disconnected", label: "Integração desconectada" },
  { type: "account_phone_removed", label: "Telefone removido" },
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

function humanizeNotificationError(error: string | null): string | null {
  if (!error) return null;

  const known: Record<string, string> = {
    missing_tenant_owner_phone: "Conta sem telefone de alertas configurado",
    missing_system_instance: "Instância do agente do sistema não configurada",
    invalid_number: "Número de destino inválido",
  };
  if (known[error]) return known[error];

  if (error.startsWith("system_instance_not_open:")) {
    const state = error.split(":")[1] ?? "?";
    return `Agente do sistema desconectado (${state})`;
  }
  if (error.startsWith("system_instance_state_check_failed:")) {
    return "Não foi possível verificar o estado do agente do sistema";
  }
  if (error.startsWith("system_session_not_authenticated:")) {
    return "Sessão conectada na API mas sem número WhatsApp ativo (sessão zumbi). Reconecte escaneando o QR.";
  }
  if (error.startsWith("system_session_check_failed:")) {
    return "Não foi possível verificar a sessão na Evolution (fetchInstances). Tente reconectar.";
  }
  if (error === "system_session_not_found_in_evolution") {
    return "Instância não encontrada na Evolution — apague e reconecte pelo painel.";
  }
  if (error === "number_not_on_whatsapp") {
    return "Número de destino não está no WhatsApp";
  }
  if (error === "missing_evolution_message_id") {
    return "Evolution aceitou mas não devolveu ID — envio não confirmado";
  }
  if (error === "delivery_timeout") {
    return "Não houve confirmação de entrega em 60s — mensagem provavelmente não chegou no celular";
  }
  if (error === "whatsapp_delivery_failed") {
    return "WhatsApp recusou a entrega — número remetente novo ou bloqueado (anti-spam). Salve o número remetente nos contatos e responda com um \"oi\" antes de testar.";
  }
  if (error.startsWith("delivery_status:")) {
    return `WhatsApp reportou falha na entrega (${error.split(":").slice(1).join(":")})`;
  }

  return error;
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
}) {
  const [logs, setLogs] = useState(props.initialLogs);
  const [connectionState, setConnectionState] = useState(props.connectionState);
  const [waJid, setWaJid] = useState(props.waJid);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [webhookReapplyBusy, setWebhookReapplyBusy] = useState(false);
  const [orphanReconcileBusy, setOrphanReconcileBusy] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [qrPanelRevision, setQrPanelRevision] = useState(0);
  const [seedQrDataUrl, setSeedQrDataUrl] = useState<string | null>(null);
  const conn = connectionLabel(connectionState);
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

  const resetAgent = useCallback(async () => {
    const confirmed = window.confirm(
      "Isto vai APAGAR a instância do agente do sistema no MyChatCRM e na Evolution API, deixando a conexão VAZIA. " +
        "Nenhuma instância nova é criada automaticamente — depois é só clicar em \"Conectar\" e escanear o QR com o número que quiser. Continuar?",
    );
    if (!confirmed) return;
    setResetBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/evolution/session?slotIndex=0", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; deletedInstance?: string | null };
      if (!res.ok) {
        setActionMessage(json.error ?? "Falha ao apagar a instância.");
        setResetBusy(false);
        return;
      }
      const deleted = json.deletedInstance ? ` (${json.deletedInstance})` : "";
      setActionMessage(
        `Instância apagada${deleted} no sistema e na Evolution. Recarregando — a conexão ficará vazia até você clicar em "Conectar".`,
      );
      setTimeout(() => window.location.reload(), 1400);
    } catch {
      setActionMessage("Falha ao apagar a instância.");
      setResetBusy(false);
    }
  }, []);

  const runDiagnose = useCallback(async () => {
    setDiagnoseBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/admin/system-agent/evolution/diagnose", { credentials: "same-origin" });
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
      if (!res.ok) {
        setActionMessage(
          humanizeNotificationError(json.error ?? json.deliveryError ?? null) ??
            json.error ??
            "Falha no envio de teste.",
        );
        await refreshLogs();
        return;
      }
      const sender =
        json.debug?.sessionOwnerJid?.split("@")[0]?.replace(/\D/g, "") ??
        waJid?.split("@")[0]?.replace(/\D/g, "");
      const senderLabel = sender ? `+${sender}` : senderLine;
      const tried = json.debug?.candidatesTried?.join(", ") ?? json.debug?.numberSent ?? testNumber.trim();
      if (json.deliveryStatus === "delivered") {
        setActionMessage(`Entregue ✓ — enviado de ${senderLabel} para ${tried}.`);
      } else {
        setActionMessage(
          `Disparado de ${senderLabel} para ${tried}. Aguardando confirmação no celular (pode levar alguns segundos). Se não chegar, salve ${senderLabel} nos contatos e responda \"oi\" antes de testar de novo.`,
        );
      }
      await refreshLogs();
    } finally {
      setTestBusy(false);
    }
  }, [refreshLogs, senderLine, testNumber]);

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

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Identidade</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
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
          <div>
            <dt className="text-content-faint">Status</dt>
            <dd className={cn("font-medium", conn.tone)}>{conn.label}</dd>
          </div>
          <div>
            <dt className="text-content-faint">Número conectado</dt>
            <dd className="text-content-secondary">{formatWaJid(waJid)}</dd>
          </div>
        </dl>
        {zombieSession ? (
          <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-3 text-xs leading-relaxed text-rose-100">
            <strong>Sessão zumbi detectada.</strong> O status diz &quot;Conectado&quot;, mas a sessão não tem um
            número WhatsApp ativo (sem identidade). A Evolution aceita os envios, porém o WhatsApp não entrega
            nada. <strong>Solução:</strong> clique em &quot;Forçar reconexão (QR)&quot; abaixo e escaneie o QR com o
            celular do chip do agente.
          </div>
        ) : null}
        <p className="mt-4 text-xs leading-relaxed text-content-muted">
          Este agente é crítico para o produto. Não desative nem remova do banco. As notificações de handoff e
          automações internas usam a instância WhatsApp configurada abaixo.
        </p>
        {senderLine !== "—" ? (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
            As notificações são enviadas do número <strong>{senderLine}</strong>. No celular, procure essa conversa
            (ou em Solicitações) — não confunda com o WhatsApp comercial do seu tenant.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
          Isolamento (Evolution Manager)
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-content-muted">
          Antes de culpar o MyChatCRM, teste envio manual no Evolution Manager para o mesmo número de destino:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-content-secondary">
          <li>
            Instância <strong>sistema</strong> (nome completo acima) → enviar texto para o número de teste
          </li>
          <li>
            Instância <strong>cliente Sofia</strong> (<code className="font-mono">mc976b7b…</code>) → mesmo número
          </li>
          <li>
            <strong>Enviar teste</strong> abaixo no MyChatCRM → comparar os três
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-content-faint">
          Se nenhum entregar → VPS/Baileys. Só Sofia entregar → reconectar sessão sistema. Manager sistema entregar
          mas MyChatCRM não → bug de formato/número no app.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Diagnóstico</h2>
        <p className="mt-2 text-xs leading-relaxed text-content-muted">
          <strong className="text-emerald-400">entregue ✓</strong> (verde) = o WhatsApp confirmou a entrega no
          aparelho — só isso é sucesso de verdade. <strong className="text-amber-400">enviado</strong> (amarelo) = a
          Evolution aceitou, mas a entrega ainda não foi confirmada pelo webhook. Se fica preso em
          &quot;enviado&quot;, a mensagem provavelmente não chegou: reconecte com QR o número {senderLine} e confirme
          que o destinatário tem o número salvo / respondeu (anti-spam de número novo).
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-content-faint">Número de teste</span>
            <input
              type="tel"
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              placeholder="62993580574"
              className="w-full rounded-lg border border-line bg-surface-elevated px-3 py-2 text-content"
            />
          </label>
          <button
            type="button"
            disabled={testBusy}
            onClick={() => void sendTest()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {testBusy ? "Enviando…" : "Enviar teste"}
          </button>
          <button
            type="button"
            disabled={restartBusy}
            onClick={() => void restartSession()}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-content-secondary disabled:opacity-60"
          >
            {restartBusy ? "Reconectando…" : "Forçar reconexão (QR)"}
          </button>
          <button
            type="button"
            disabled={diagnoseBusy}
            onClick={() => void runDiagnose()}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-content-secondary disabled:opacity-60"
          >
            {diagnoseBusy ? "Verificando…" : "Diagnóstico avançado"}
          </button>
          <button
            type="button"
            disabled={webhookReapplyBusy}
            onClick={() => void reapplyWebhook()}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-content-secondary disabled:opacity-60"
          >
            {webhookReapplyBusy ? "Aplicando…" : "Re-aplicar webhook"}
          </button>
          <button
            type="button"
            disabled={orphanReconcileBusy}
            onClick={() => void reconcileOrphans()}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-content-secondary disabled:opacity-60"
          >
            {orphanReconcileBusy ? "Reconciliando…" : "Reconciliar órfãos"}
          </button>
        </div>
        {actionMessage ? <p className="mt-3 text-xs text-content-muted">{actionMessage}</p> : null}

        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3">
          <p className="text-xs font-semibold text-rose-200">Zona de risco — apagar conexão</p>
          <p className="mt-1 text-xs leading-relaxed text-content-muted">
            Apaga a instância no MyChatCRM <strong>e</strong> na Evolution API, deixando a conexão
            <strong> vazia</strong> (não recria sozinho). Depois é só clicar em <strong>Conectar</strong> na
            seção do WhatsApp acima para criar uma instância <strong>nova (nome e sessão limpos)</strong> e
            escanear o QR com o número que quiser — útil quando a sessão fica presa ou para trocar de número.
          </p>
          <button
            type="button"
            disabled={resetBusy}
            onClick={() => void resetAgent()}
            className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
          >
            {resetBusy ? "Apagando…" : "Apagar conexão (sistema + Evolution)"}
          </button>
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
        <div className="mb-4 flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
            WhatsApp do agente do sistema
          </h2>
        </div>
        <EvolutionQrSlotPanel
          key={`system-agent-qr-${qrPanelRevision}`}
          slotIndex={0}
          sessionApiPath="/api/admin/system-agent/evolution/session"
          statusApiPath="/api/admin/system-agent/evolution/status"
          autoProvision={false}
          seedQrDataUrl={seedQrDataUrl}
        />
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
          Runbook operacional (VPS / Evolution)
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-content-secondary">
          <li>
            <strong>Reconectar sessão</strong> — &quot;Forçar reconexão (QR)&quot; ou apagar conexão → Conectar → QR
            com o número oficial do sistema
          </li>
          <li>
            <strong>Re-aplicar webhook</strong> — botão acima; confirme MESSAGES_UPDATE + CONNECTION_UPDATE no Manager
          </li>
          <li>
            <strong>Reconciliar órfãos</strong> — após envios ou se diagnóstico mostrar eventos órfãos pendentes
          </li>
          <li>
            <strong>Restart VPS</strong> — no hPanel/SSH:{" "}
            <code className="font-mono">scripts/evolution-vps-maintenance.sh restart</code>
          </li>
          <li>
            <strong>Limpar instâncias órfãs</strong> — no Manager, apague só{" "}
            <code className="font-mono">mc049357*</code> (nunca <code className="font-mono">mc976b7b*</code> de
            clientes). Script:{" "}
            <code className="font-mono">scripts/evolution-vps-maintenance.sh orphans</code>
          </li>
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">
          Checklist de validação (E2E)
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-content-muted">
          Após reconectar, valide cada fluxo. Sucesso = mensagem no celular <strong>e</strong> log com status{" "}
          <span className="text-emerald-400">entregue ✓</span> em até 60s.
        </p>
        <ul className="mt-3 space-y-2 text-xs">
          {E2E_REQUIRED_FLOWS.map((flow) => {
            const result = evaluateE2EFlow(logs, flow.type);
            const tone =
              result === "pass"
                ? "text-emerald-400"
                : result === "fail"
                  ? "text-rose-400"
                  : result === "pending"
                    ? "text-amber-400"
                    : "text-content-muted";
            const label =
              result === "pass"
                ? "✓ OK (≤60s)"
                : result === "fail"
                  ? "✗ falhou"
                  : result === "pending"
                    ? "… em andamento"
                    : "— não testado";
            return (
              <li key={flow.type} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/60 px-3 py-2">
                <span className="text-content-secondary">{flow.label}</span>
                <span className={`font-medium ${tone}`}>{label}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-content-faint">
          Meta real: <strong>5/5 entregue ✓</strong> (confirmado no aparelho pelo webhook). &quot;enviado&quot;
          (amarelo) = aceito pela Evolution, mas entrega ainda não confirmada. &quot;falha&quot; = Evolution recusou o
          envio.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-content-secondary">
          <li>
            <strong>Reconectar sessão limpa</strong> — apagar conexão → Conectar → escanear QR → aguardar
            Connected
          </li>
          <li>
            <strong>Validar webhook</strong> — Diagnóstico avançado → URL esperada deve coincidir com a instância no
            Evolution Manager (eventos: MESSAGES_UPDATE, CONNECTION_UPDATE)
          </li>
          <li>
            <strong>Re-aplicar webhook</strong> — botão acima ou confirmar URL no Evolution Manager
          </li>
          <li>
            <strong>Enviar teste</strong> — número de destino acima (verifique também Solicitações no WhatsApp)
          </li>
          <li>
            <strong>Warm-up anti-spam</strong> — do celular destino, mande &quot;oi&quot; para {senderLine} antes do
            teste/código
          </li>
          <li>
            <strong>Código de verificação</strong> — Configurações → confirmar telefone
          </li>
          <li>
            <strong>Handoff</strong> — conversa com handoffNumero configurado no agente
          </li>
          <li>
            <strong>Integração desconectada</strong> — desconectar WhatsApp do cliente → alerta ao dono
          </li>
          <li>
            <strong>Telefone removido</strong> — remover telefone da conta
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-content-faint">
          Se aparece &quot;enviado ✓&quot; mas nada chega no celular: o problema é a sessão/número na VPS. Reinicie a
          Evolution (<code className="font-mono">scripts/evolution-vps-maintenance.sh restart</code>), apague
          instâncias órfãs <code className="font-mono">mc049357*</code> no Manager (nunca{" "}
          <code className="font-mono">mc976b7b*</code>), ou apague e reconecte a instância do sistema escaneando o QR
          com o número que vai disparar as notificações.
        </p>
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
            onClick={() => void refreshLogs()}
            className="text-xs font-medium text-primary hover:underline"
          >
            Atualizar
          </button>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhuma notificação registrada ainda.</p>
        ) : (
          <ul className="space-y-3">
            {logs.map((item) => {
              const status = notificationStatusLabel(item.status);
              const metaLine = formatLogMetadata(item);
              const errorLine = humanizeNotificationError(item.error);

              return (
                <li key={item.id} className="rounded-lg border border-line/80 bg-surface-elevated/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-wide text-content-secondary">{item.type}</span>
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
      </section>
    </div>
  );
}
