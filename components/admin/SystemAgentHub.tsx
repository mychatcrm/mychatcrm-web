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
  if (status === "delivered") return { label: "entregue ✓", tone: "text-emerald-400" };
  if (status === "sent") return { label: "enviado (sem confirmação)", tone: "text-amber-400" };
  if (status === "delivery_failed") {
    return { label: "falha na entrega", tone: "text-rose-400" };
  }
  if (status === "skipped") {
    return { label: "não enviado — sem telefone de alertas", tone: "text-amber-400" };
  }
  return { label: status, tone: "text-rose-400" };
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
  if (error === "number_not_on_whatsapp") {
    return "Número de destino não está no WhatsApp";
  }
  if (error === "missing_evolution_message_id") {
    return "Evolution aceitou mas não devolveu ID — envio não confirmado";
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
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
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
        setActionMessage(
          `Escaneie o QR Code abaixo com o celular do número ${senderLine}. Sem isso, o WhatsApp aceita o envio na API mas não entrega no celular.`,
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
      const json = (await res.json().catch(() => ({}))) as { error?: string; debug?: { numberSent?: string; candidatesTried?: string[] } };
      if (!res.ok) {
        setActionMessage(json.error ?? "Falha no envio de teste.");
        return;
      }
      const tried = json.debug?.candidatesTried?.join(", ") ?? json.debug?.numberSent ?? testNumber.trim();
      setActionMessage(
        `API aceitou o envio (${tried}). Verifique o WhatsApp de ${senderLine} → conversa com seu número, ou Solicitações. Se não chegar em 1 min, clique em "Forçar reconexão (QR)".`,
      );
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Diagnóstico</h2>
        <p className="mt-2 text-xs leading-relaxed text-content-muted">
          Se o painel mostra &quot;enviado&quot; mas nada chega: a sessão WhatsApp na Evolution pode estar
          &quot;zombie&quot; (API ok, entrega falha). Use reconexão com QR no celular {senderLine}.
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
        </div>
        {actionMessage ? <p className="mt-3 text-xs text-content-muted">{actionMessage}</p> : null}
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
                            : r.status === "sent"
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
          slotIndex={0}
          sessionApiPath="/api/admin/system-agent/evolution/session"
          statusApiPath="/api/admin/system-agent/evolution/status"
        />
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
