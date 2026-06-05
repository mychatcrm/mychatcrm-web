"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelAppearancePortalBridge } from "@/components/panel/PanelAppearance";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import type { ClientSession } from "@/lib/client-auth";
import type { Agent } from "@/lib/types";
import { AgentFormCompact } from "./AgentFormCompact";
import { agentFromWizardDraft, agentFromWizardDraftUpdate, type AgentWizardDraft } from "@/lib/agents";

function AgentFormPortalOverlay({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <PanelAppearancePortalBridge>
      <div
        className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative z-[91] flex max-h-[min(100dvh,100svh)] min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-line/70 bg-surface-deep/95 sm:h-auto sm:max-h-[min(92dvh,920px)] sm:w-[min(calc(100vw-2rem),980px)] sm:rounded-xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 bg-surface-deep/95 px-4 py-4 sm:px-5">
            <div className="min-w-0 pr-2">
              <h2 id={titleId} className="truncate text-lg font-semibold text-content">
                {title}
              </h2>
              <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-content-muted sm:line-clamp-1">{subtitle}</p>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 !min-h-9 !px-2" type="button" onClick={onClose} aria-label="Fechar">
              ✕
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pb-5 sm:pt-3">
            {children}
          </div>
        </div>
      </div>
    </PanelAppearancePortalBridge>,
    document.body,
  );
}

export function AgentCreateOverlay({
  open,
  onClose,
  session,
  onCreated,
  formKey,
}: {
  open: boolean;
  onClose: () => void;
  session: ClientSession;
  onCreated: (agent: Agent) => void;
  /** Incrementa ao abrir para repor o estado do formulário. */
  formKey: number;
}) {
  const handleSubmit = (draft: AgentWizardDraft) => {
    onCreated(agentFromWizardDraft(draft, session.tenantId));
    onClose();
  };

  return (
    <AgentFormPortalOverlay
      open={open}
      onClose={onClose}
      title="Criar novo agente"
      subtitle="A lista de agentes continua por baixo, desfocada. Tecla Esc ou ✕ para fechar sem guardar."
    >
      <AgentFormCompact
        key={formKey}
        mode="create"
        embedded
        tenantId={session.tenantId}
        onRequestClose={onClose}
        onSubmit={handleSubmit}
      />
    </AgentFormPortalOverlay>
  );
}

export function AgentManageOverlay({
  agent,
  onClose,
  formKey,
  onUpdated,
  onDeleted,
}: {
  agent: Agent | null;
  onClose: () => void;
  formKey: number;
  onUpdated: (agent: Agent) => void;
  onDeleted: (agentId: string) => void;
}) {
  const open = agent != null;

  const handleSubmit = (draft: AgentWizardDraft) => {
    if (!agent) return;
    onUpdated(agentFromWizardDraftUpdate(agent, draft));
    onClose();
  };

  return (
    <AgentFormPortalOverlay
      open={open}
      onClose={onClose}
      title="Gerenciar agente"
      subtitle={
        agent
          ? `${agent.nome} — mesmo fluxo do «Novo agente», já preenchido. Esc ou ✕ fecha sem salvar.`
          : "Esc ou ✕ para fechar."
      }
    >
      {agent ? (
        <AgentFormCompact
          key={`${formKey}-${agent.id}`}
          mode="edit"
          initialAgent={agent}
          embedded
          tenantId={agent.clientId}
          onRequestClose={onClose}
          onSubmit={handleSubmit}
          onDeleteAgent={() => {
            onDeleted(agent.id);
            onClose();
          }}
        />
      ) : null}
    </AgentFormPortalOverlay>
  );
}
