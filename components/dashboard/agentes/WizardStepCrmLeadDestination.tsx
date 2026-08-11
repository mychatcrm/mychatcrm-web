"use client";

import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import type { AgentWizardDraft } from "@/lib/agents";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldHelp } from "./agent-field-help";
import { CrmDestinationBlock } from "./CrmDestinationBlock";

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
            Opcional e independente do passo 1. Se alguém da sua equipe arrastar o card à mão, o
            agente para de mexer nele.
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
