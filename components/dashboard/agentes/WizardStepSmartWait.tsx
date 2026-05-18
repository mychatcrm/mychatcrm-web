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
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-card px-3 py-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={draft.smartWaitEnabled}
          onChange={(event) => onChange({ ...draft, smartWaitEnabled: event.target.checked })}
        />
        <InlineFieldTitle title="Ativar espera inteligente" help={AGENT_FIELD_HELP.smartWaitAtivar} />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel label="Espera inicial (s)" help={AGENT_FIELD_HELP.smartWaitInicial} />
          <Input
            type="number"
            min={1}
            max={60}
            disabled={!draft.smartWaitEnabled}
            value={draft.smartWaitInitialSeconds}
            onChange={(event) =>
              onChange({ ...draft, smartWaitInitialSeconds: Number(event.target.value) || 7 })
            }
          />
        </div>
        <div>
          <FieldLabel label="Após nova mensagem (s)" help={AGENT_FIELD_HELP.smartWaitNovaMsg} />
          <Input
            type="number"
            min={1}
            max={120}
            disabled={!draft.smartWaitEnabled}
            value={draft.smartWaitFollowupSeconds}
            onChange={(event) =>
              onChange({ ...draft, smartWaitFollowupSeconds: Number(event.target.value) || 10 })
            }
          />
        </div>
        <div>
          <FieldLabel label="Espera máxima (s)" help={AGENT_FIELD_HELP.smartWaitMaxima} />
          <Input
            type="number"
            min={5}
            max={180}
            disabled={!draft.smartWaitEnabled}
            value={draft.smartWaitMaxSeconds}
            onChange={(event) =>
              onChange({ ...draft, smartWaitMaxSeconds: Number(event.target.value) || 30 })
            }
          />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm text-content-secondary">
        <input
          type="checkbox"
          disabled={!draft.smartWaitEnabled}
          checked={draft.smartWaitDedupeRepeated}
          onChange={(event) => onChange({ ...draft, smartWaitDedupeRepeated: event.target.checked })}
        />
        <InlineFieldTitle title="Deduplicar mensagens repetidas" help={AGENT_FIELD_HELP.smartWaitDedupe} />
      </label>
    </div>
  );
}
