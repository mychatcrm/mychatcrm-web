"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import type { AgentWizardDraft } from "@/lib/agents";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldLabel, InlineFieldTitle } from "./agent-field-help";

export function WizardStepSmartWait({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-start gap-3 rounded-xl bg-surface-elevated/30 px-3 py-3">
        <span
          aria-hidden="true"
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
        />
        <InlineFieldTitle title="Agrupamento de mensagens sempre ativo" help={AGENT_FIELD_HELP.smartWaitAtivar} />
      </div>

      <div className="grid min-w-0 gap-3 min-[560px]:grid-cols-3">
        <div className="min-w-0">
          <FieldLabel label="Espera inicial (s)" help={AGENT_FIELD_HELP.smartWaitInicial} />
          <Input
            type="number"
            min={1}
            max={60}
            value={draft.smartWaitInitialSeconds}
            onChange={(event) =>
              onChange({ ...draft, smartWaitInitialSeconds: Number(event.target.value) || 7 })
            }
          />
        </div>
        <div className="min-w-0">
          <FieldLabel label="Após nova mensagem (s)" help={AGENT_FIELD_HELP.smartWaitNovaMsg} />
          <Input
            type="number"
            min={1}
            max={120}
            value={draft.smartWaitFollowupSeconds}
            onChange={(event) =>
              onChange({ ...draft, smartWaitFollowupSeconds: Number(event.target.value) || 10 })
            }
          />
        </div>
        <div className="min-w-0">
          <FieldLabel label="Espera máxima (s)" help={AGENT_FIELD_HELP.smartWaitMaxima} />
          <Input
            type="number"
            min={5}
            max={180}
            value={draft.smartWaitMaxSeconds}
            onChange={(event) =>
              onChange({ ...draft, smartWaitMaxSeconds: Number(event.target.value) || 30 })
            }
          />
        </div>
      </div>

      <label className="flex min-w-0 items-center gap-3 rounded-xl bg-surface-elevated/20 px-3 py-2.5 text-sm text-content-secondary">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={draft.smartWaitDedupeRepeated}
          onChange={(event) => onChange({ ...draft, smartWaitDedupeRepeated: event.target.checked })}
        />
        <InlineFieldTitle title="Deduplicar mensagens repetidas" help={AGENT_FIELD_HELP.smartWaitDedupe} />
      </label>
    </div>
  );
}
