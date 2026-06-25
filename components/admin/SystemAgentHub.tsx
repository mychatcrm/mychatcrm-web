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
  if (status === "sent") return { label: "enviado", tone: "text-emerald-400" };
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
  const [testNumber, setTestNumber] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const conn = connectionLabel(connectionState);
  const senderLine = formatWaJid(waJid);

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
    const json = (await res.json()) as { connectionState?: string; waJid?: string | null };
    if (typeof json.connectionState === "string" && json.connectionState.trim()) {
      setConnectionState(json.connectionState.trim());
    }
    if (json.waJid) setWaJid(json.waJid);
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
        body: JSON.stringify({ action: "restart" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; connectionState?: string };
      if (!res.ok) {
        setActionMessage(json.error ?? "Falha ao reiniciar sessão.");
        return;
      }
      if (json.connectionState) setConnectionState(json.connectionState);
      setActionMessage("Sessão reiniciada. Aguarde alguns segundos e teste o envio novamente.");
      await refreshIdentity();
    } finally {
      setRestartBusy(false);
    }
  }, [refreshIdentity]);

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
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionMessage(json.error ?? "Falha no envio de teste.");
        return;
      }
      setActionMessage(
        `Teste enviado para ${testNumber.trim()}. Verifique o WhatsApp — a mensagem vem de ${senderLine}, não do número comercial do tenant.`,
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
          Se o painel mostra &quot;enviado&quot; mas nada chega no celular, reinicie a sessão e envie um teste.
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
            {restartBusy ? "Reiniciando…" : "Reiniciar sessão"}
          </button>
        </div>
        {actionMessage ? <p className="mt-3 text-xs text-content-muted">{actionMessage}</p> : null}
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
