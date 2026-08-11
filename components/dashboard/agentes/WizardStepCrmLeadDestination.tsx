"use client";

import { useMemo } from "react";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import type { AgentWizardDraft } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldHelp, FieldLabel, InlineFieldTitle } from "./agent-field-help";

type CrmFunnel = ReturnType<typeof useCrmFunnels>["funnels"][number];

/**
 * Um destino de CRM: liga/desliga + funil + coluna. São dois na tela — o do
 * primeiro contato e o da primeira resposta do lead — com a mesma mecânica e
 * campos diferentes, por isso o bloco vive aqui em vez de duplicado.
 */
function CrmDestinationBlock({
  funnels,
  enabled,
  funnelId,
  columnId,
  help,
  onChange,
}: {
  funnels: CrmFunnel[];
  enabled: boolean;
  funnelId: string;
  columnId: string;
  help: {
    off: string;
    on: string;
    funnel: string;
    column: string;
    offTitle: string;
    onTitle: string;
  };
  onChange: (next: { enabled: boolean; funnelId: string; columnId: string }) => void;
}) {
  const selectedFunnel = useMemo(
    () => funnels.find((f) => f.id === funnelId) ?? funnels[0],
    [funnels, funnelId],
  );
  const stageOptions = selectedFunnel?.columns ?? [];
  const selectedColumn = stageOptions.some((c) => c.id === columnId)
    ? columnId
    : (stageOptions[0]?.id ?? "");

  const setMode = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      onChange({ enabled: false, funnelId, columnId });
      return;
    }
    onChange({
      enabled: true,
      funnelId: selectedFunnel?.id ?? funnelId,
      columnId: selectedColumn,
    });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { value: false, title: help.offTitle, help: help.off },
          { value: true, title: help.onTitle, help: help.on },
        ].map((option) => {
          const active = enabled === option.value;
          return (
            <button
              key={option.title}
              type="button"
              onClick={() => setMode(option.value)}
              className={cn(
                "rounded-xl border px-4 py-3 text-left transition",
                active
                  ? "border-primary/45 bg-primary/10 text-content"
                  : "border-line bg-surface-card text-content-secondary hover:border-primary/30 hover:bg-surface-elevated/40",
              )}
            >
              <InlineFieldTitle title={option.title} help={option.help} />
            </button>
          );
        })}
      </div>

      {enabled ? (
        <div className="grid min-w-0 gap-4 rounded-xl border border-line bg-surface-deep/40 p-4 sm:grid-cols-2">
          <div>
            <FieldLabel label="Funil de destino" help={help.funnel} />
            <Select
              className="mt-2"
              value={selectedFunnel?.id ?? ""}
              onChange={(event) => {
                const funnel = funnels.find((f) => f.id === event.target.value);
                if (!funnel) return;
                onChange({
                  enabled: true,
                  funnelId: funnel.id,
                  columnId: funnel.columns[0]?.id ?? "",
                });
              }}
            >
              {funnels.map((funnel) => (
                <option key={funnel.id} value={funnel.id}>
                  {funnel.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel label="Coluna/etapa de destino" help={help.column} />
            <Select
              key={selectedFunnel?.id ?? "no-funnel"}
              className="mt-2"
              value={selectedColumn}
              onChange={(event) =>
                onChange({
                  enabled: true,
                  funnelId: selectedFunnel?.id ?? funnelId,
                  columnId: event.target.value,
                })
              }
            >
              {stageOptions.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function WizardStepCrmLeadDestination({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const { funnels } = useCrmFunnels();

  return (
    <div className="min-w-0 space-y-6">
      <section className="min-w-0 space-y-4">
        <div>
          <p className="text-sm font-semibold text-content">1. Quando o agente atender o lead</p>
          <p className="mt-0.5 text-xs text-content-muted">
            Assim que o agente entra em ação com um lead novo.
          </p>
        </div>
        <CrmDestinationBlock
          funnels={funnels}
          enabled={draft.crmAutoMoveEnabled}
          funnelId={draft.crmTargetFunnelId}
          columnId={draft.crmTargetColumnId}
          help={{
            offTitle: "Não mover no CRM",
            onTitle: "Mover para funil/coluna específica",
            off: AGENT_FIELD_HELP.crmNaoMover,
            on: AGENT_FIELD_HELP.crmMover,
            funnel: AGENT_FIELD_HELP.crmFunil,
            column: AGENT_FIELD_HELP.crmColuna,
          }}
          onChange={(next) =>
            onChange({
              ...draft,
              crmAutoMoveEnabled: next.enabled,
              crmTargetFunnelId: next.funnelId,
              crmTargetColumnId: next.columnId,
            })
          }
        />
      </section>

      <section className="min-w-0 space-y-4 border-t border-line/60 pt-6">
        <div>
          <p className="text-sm font-semibold text-content">2. Quando o lead responder</p>
          <p className="mt-0.5 text-xs text-content-muted">
            Opcional e independente do passo 1. Acontece só na primeira resposta — depois disso o
            card fica onde a sua equipe deixar.
          </p>
        </div>
        <CrmDestinationBlock
          funnels={funnels}
          enabled={draft.crmMoveOnLeadReplyEnabled}
          funnelId={draft.crmReplyFunnelId}
          columnId={draft.crmReplyColumnId}
          help={{
            offTitle: "Deixar onde está",
            onTitle: "Mover para outra funil/coluna",
            off: AGENT_FIELD_HELP.crmRespostaNaoMover,
            on: AGENT_FIELD_HELP.crmRespostaMover,
            funnel: AGENT_FIELD_HELP.crmRespostaFunil,
            column: AGENT_FIELD_HELP.crmRespostaColuna,
          }}
          onChange={(next) =>
            onChange({
              ...draft,
              crmMoveOnLeadReplyEnabled: next.enabled,
              crmReplyFunnelId: next.funnelId,
              crmReplyColumnId: next.columnId,
            })
          }
        />
      </section>

      <p className="flex flex-wrap items-center gap-1.5 text-xs text-content-muted">
        <span>Regra automática no CRM</span>
        <FieldHelp content={AGENT_FIELD_HELP.crmRegraBackend} />
      </p>
    </div>
  );
}
