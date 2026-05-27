"use client";

import { Bot, Handshake, Kanban, RadioTower, Sparkles, Timer, Volume2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { defaultWizardDraft, draftFromAgent, type AgentWizardDraft, validateCompactAgentDraft } from "@/lib/agents";
import { AgentWizardPromptModal } from "./AgentWizardPromptModal";
import { WizardStep1Identidade } from "./WizardStep1Identidade";
import { WizardStep2Treinamento } from "./WizardStep2Treinamento";
import { WizardStep3Ativacao } from "./WizardStep3Ativacao";
import { WizardStep4Fluxo } from "./WizardStep4Fluxo";
import { WizardStepFollowUpInteligente } from "./WizardStepFollowUpInteligente";
import { WizardStepWhatsappLinha } from "./WizardStepWhatsappLinha";
import { WizardStepVoz } from "./WizardStepVoz";
import { WizardStepSmartWait } from "./WizardStepSmartWait";
import { WizardStepCrmLeadDestination } from "./WizardStepCrmLeadDestination";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldHelp } from "./agent-field-help";

const DELETE_AGENT_CONFIRM_TEXT = "QUERO APAGAR";

function AdvancedSection({
  title,
  description,
  titleIcon,
  children,
}: {
  title: string;
  description?: string;
  /** Ícone Lucide monocromático (mesma linha visual da barra lateral). */
  titleIcon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group min-w-0 rounded-xl border border-line bg-surface-card">
      <summary
        className={cn(
          "flex min-w-0 cursor-pointer list-none items-start justify-between gap-3 px-3 py-3.5 text-left text-sm font-semibold text-content sm:px-4",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          {titleIcon ? (
            <span
              className="mt-0.5 flex shrink-0 text-content-muted transition-colors group-hover:text-content-secondary [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0"
              aria-hidden
            >
              {titleIcon}
            </span>
          ) : null}
          <span className="min-w-0 break-words">
            {title}
            {description ? (
              <span className="mt-0.5 block text-xs font-normal text-content-muted">{description}</span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-xs text-content-faint transition group-open:rotate-180" aria-hidden>
          ▼
        </span>
      </summary>
      <div className="min-w-0 border-t border-line px-3 py-4 sm:px-4">{children}</div>
    </details>
  );
}

export function AgentFormCompact({
  initialAgent,
  mode,
  onSubmit,
  embedded,
  onRequestClose,
  onDeleteAgent,
  tenantId,
}: {
  initialAgent?: Agent;
  mode: "create" | "edit";
  onSubmit?: (draft: AgentWizardDraft) => void;
  /** Formulário dentro de overlay (sem link «Voltar»; Cancelar chama `onRequestClose`). */
  embedded?: boolean;
  onRequestClose?: () => void;
  /** Só em edição no overlay: após confirmação com frase, remove o agente. */
  onDeleteAgent?: () => void;
  /** Para validar e listar linhas WhatsApp (Integrações + plano). */
  tenantId?: string;
}) {
  const { funnels } = useCrmFunnels();
  const [draft, setDraft] = useState<AgentWizardDraft>(() => {
    if (!initialAgent) return defaultWizardDraft;
    try {
      return draftFromAgent(initialAgent);
    } catch {
      return defaultWizardDraft;
    }
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [openPromptModal, setOpenPromptModal] = useState(false);
  const [generateNotice, setGenerateNotice] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [simulationMessage, setSimulationMessage] = useState("");
  const [simulationReply, setSimulationReply] = useState("");
  const [simulationContext, setSimulationContext] = useState<Record<string, unknown> | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [simulationError, setSimulationError] = useState("");

  const submit = () => {
    const message = validateCompactAgentDraft(draft, funnels, tenantId);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    if (onSubmit) {
      onSubmit(draft);
      return;
    }
    setSuccess(mode === "create" ? "Agente criado com sucesso (mock)." : "Agente atualizado com sucesso (mock).");
  };

  const closeDeleteModal = () => {
    setDeleteOpen(false);
    setDeletePhrase("");
  };

  const canConfirmDelete = deletePhrase.trim() === DELETE_AGENT_CONFIRM_TEXT;

  const runSimulation = async () => {
    if (!initialAgent?.id) {
      setSimulationError("Salve o agente antes de testar com IA.");
      return;
    }
    if (!simulationMessage.trim()) {
      setSimulationError("Digite uma mensagem para simular.");
      return;
    }
    setSimulationLoading(true);
    setSimulationError("");
    setSimulationReply("");
    setSimulationContext(null);
    try {
      const response = await fetch(`/api/client/agentes/${encodeURIComponent(initialAgent.id)}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: simulationMessage, draft }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        reply?: string;
        contextUsed?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Erro ao simular resposta.");
      setSimulationReply(data.reply ?? "");
      setSimulationContext(data.contextUsed ?? null);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Erro ao simular resposta.");
    } finally {
      setSimulationLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "mx-auto w-full min-w-0 space-y-4 sm:space-y-6",
        embedded ? "max-w-none" : "max-w-3xl",
      )}
    >
      {!embedded ? (
        <Link
          href="/dashboard/agentes"
          className="inline-flex max-w-full break-words text-sm font-medium text-primary hover:underline"
        >
          ← Voltar para Meus Agentes
        </Link>
      ) : null}

      <div
        className={cn(
          "min-w-0 overflow-x-hidden rounded-xl border border-line bg-surface-deep/50 p-4 sm:p-6",
          embedded && "rounded-xl sm:rounded-xl sm:border-line/80",
        )}
      >
        {!embedded ? (
          <div className="mb-5 sm:mb-6">
            <h2 className="text-xl font-semibold text-content sm:text-2xl">
              {mode === "create" ? "Criar novo agente" : "Editar agente"}
            </h2>
          </div>
        ) : null}

        <div
          className={cn(
            "mb-4 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:p-4",
            embedded && "mb-5",
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-content">Preencher instruções com IA</p>
            <p className="mt-0.5 text-xs text-content-muted">
              Descreva o negócio e anexe arquivos para gerar identidade, objetivo, instruções e regras automaticamente.
            </p>
          </div>
          <Button
            type="button"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => {
              setGenerateNotice("");
              setOpenPromptModal(true);
            }}
          >
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            Gerar com IA
          </Button>
        </div>

        {generateNotice ? (
          <p className="-mt-2 mb-2 text-sm text-amber-600 dark:text-amber-400">{generateNotice}</p>
        ) : null}

        <div className="space-y-6 sm:space-y-8">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Identidade</h3>
            <WizardStep1Identidade draft={draft} onChange={setDraft} />
          </section>

          {tenantId ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">WhatsApp</h3>
              <WizardStepWhatsappLinha tenantId={tenantId} draft={draft} onChange={setDraft} />
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Tempo de resposta</h3>
            <WizardStepSmartWait draft={draft} onChange={setDraft} />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Treinamento</h3>
            <WizardStep2Treinamento draft={draft} onChange={setDraft} agentId={initialAgent?.id} />
          </section>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-content-secondary">Avançado</h3>
            <div className="space-y-2">
              <AdvancedSection
                title="Ativação e origens"
                description="Onde o agente entra em ação (Lead Ads, keyword, orgânico, etc.)."
                titleIcon={<RadioTower strokeWidth={1.75} />}
              >
                <WizardStep3Ativacao
                  draft={draft}
                  onChange={setDraft}
                  agentId={initialAgent?.id ?? (initialAgent as { agent_id?: string } | undefined)?.agent_id}
                />
              </AdvancedSection>
              <AdvancedSection
                title="Transferência humana e objetivo final"
                description="Configure quando o agente passa o atendimento para uma pessoa real e qual ação ele deve buscar na conversa."
                titleIcon={<Handshake strokeWidth={1.75} />}
              >
                <WizardStep4Fluxo draft={draft} onChange={setDraft} />
              </AdvancedSection>
              <AdvancedSection
                title="Destino do lead no CRM"
                description="Opcional: mova automaticamente leads tocados por este agente."
                titleIcon={<Kanban strokeWidth={1.75} />}
              >
                <WizardStepCrmLeadDestination draft={draft} onChange={setDraft} />
              </AdvancedSection>
              <AdvancedSection
                title="Configurações de Follow-up"
                description="Retomada contextual a partir do histórico completo — sem templates fixos."
                titleIcon={<Timer strokeWidth={1.75} />}
              >
                <WizardStepFollowUpInteligente
                  draft={draft}
                  onChange={setDraft}
                  agentId={initialAgent?.id ?? (initialAgent as { agent_id?: string } | undefined)?.agent_id}
                />
              </AdvancedSection>
              <AdvancedSection
                title="Modo de Resposta"
                description="Escolha entre texto e áudio com ElevenLabs, incluindo a voz usada pelo agente."
                titleIcon={<Volume2 strokeWidth={1.75} />}
              >
                <WizardStepVoz draft={draft} onChange={setDraft} />
              </AdvancedSection>
              <AdvancedSection
                title="Teste do agente"
                description="Simule uma resposta sem enviar WhatsApp nem criar lead real."
                titleIcon={<Bot strokeWidth={1.75} />}
              >
                <div className="space-y-3">
                  <textarea
                    value={simulationMessage}
                    onChange={(event) => setSimulationMessage(event.target.value)}
                    placeholder="Digite uma mensagem de cliente para testar o comportamento do agente."
                    className="min-h-[96px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-content-muted">
                      <span>Simulação</span>
                      <FieldHelp content={AGENT_FIELD_HELP.simulacao} />
                    </p>
                    <Button type="button" onClick={runSimulation} disabled={simulationLoading} className="w-full sm:w-auto">
                      {simulationLoading ? "Simulando..." : "Simular resposta"}
                    </Button>
                  </div>
                  {simulationError ? (
                    <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                      {simulationError}
                    </p>
                  ) : null}
                  {simulationReply ? (
                    <div className="rounded-xl border border-line bg-surface-elevated/35 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-faint">Resposta simulada</p>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-content-secondary">{simulationReply}</p>
                      {simulationContext ? (
                        <p className="mt-3 text-xs text-content-muted">
                          Contexto usado: {Object.entries(simulationContext).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </AdvancedSection>
            </div>
          </div>
        </div>

        {error ? <p className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
        {success ? <p className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</p> : null}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {embedded && onRequestClose ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full min-h-[44px] sm:w-auto"
              onClick={onRequestClose}
            >
              Cancelar
            </Button>
          ) : (
            <Link
              href="/dashboard/agentes"
              className={cn(
                "inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-primary/35 bg-surface-elevated/20 px-5 text-sm font-medium text-primary transition hover:border-primary/55 hover:bg-primary/10 sm:w-auto",
              )}
            >
              Cancelar
            </Link>
          )}
          <Button className="w-full min-h-[44px] sm:w-auto" onClick={submit}>
            {mode === "create" ? "Criar agente" : "Salvar alterações"}
          </Button>
        </div>

        {mode === "edit" && embedded && onDeleteAgent ? (
          <div className="mt-10 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-5 sm:px-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-200/90">Excluir agente</p>
            <p className="mt-1.5 text-sm leading-relaxed text-content-muted">
              Remove o agente da lista nesta demonstração. Não há como desfazer aqui.
            </p>
            <Button
              type="button"
              variant="danger"
              className="mt-4 w-full min-h-[44px] sm:w-auto"
              onClick={() => setDeleteOpen(true)}
            >
              Excluir agente
            </Button>
          </div>
        ) : null}
      </div>

      <Modal
        open={deleteOpen}
        onClose={closeDeleteModal}
        title="Excluir agente"
        className="max-w-md"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={closeDeleteModal}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={!canConfirmDelete}
              onClick={() => {
                onDeleteAgent?.();
                closeDeleteModal();
              }}
            >
              Confirmar exclusão
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-content-secondary">
          <p>
            Para confirmar, digite exatamente{" "}
            <span className="rounded-md bg-surface-deep px-1.5 py-0.5 font-mono text-xs font-semibold text-content">
              {DELETE_AGENT_CONFIRM_TEXT}
            </span>{" "}
            no campo abaixo.
          </p>
          <div>
            <label className="text-xs font-medium text-content-faint" htmlFor={`agent-form-delete-phrase-${initialAgent?.id ?? "x"}`}>
              Frase de confirmação
            </label>
            <Input
              id={`agent-form-delete-phrase-${initialAgent?.id ?? "x"}`}
              className="mt-1.5 font-mono text-sm"
              value={deletePhrase}
              onChange={(e) => setDeletePhrase(e.target.value)}
              placeholder={DELETE_AGENT_CONFIRM_TEXT}
              autoComplete="off"
              aria-invalid={deletePhrase.length > 0 && !canConfirmDelete}
            />
          </div>
        </div>
      </Modal>

      <AgentWizardPromptModal
        open={openPromptModal}
        onClose={() => setOpenPromptModal(false)}
        draft={draft}
        onApply={(next, fileWarnings) => {
          setDraft(next);
          setError("");
          if (fileWarnings.length) {
            setGenerateNotice(`Instruções geradas. Avisos: ${fileWarnings.join(" · ")}`);
          } else {
            setGenerateNotice("Instruções geradas com sucesso. Revise os campos antes de salvar.");
          }
        }}
      />
    </div>
  );
}
