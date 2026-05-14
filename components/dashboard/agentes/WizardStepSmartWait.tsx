"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import type { AgentWizardDraft } from "@/lib/agents";

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
        <span>
          <span className="block text-sm font-semibold text-content">Ativar espera inteligente</span>
          <span className="mt-1 block text-xs text-content-muted">
            Aguarda o cliente terminar de digitar mensagens seguidas antes de responder no WhatsApp.
          </span>
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-content-muted">Espera inicial (s)</span>
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
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-content-muted">Após nova mensagem (s)</span>
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
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-content-muted">Espera máxima (s)</span>
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
        </label>
      </div>

      <label className="flex items-center gap-3 text-sm text-content-secondary">
        <input
          type="checkbox"
          disabled={!draft.smartWaitEnabled}
          checked={draft.smartWaitDedupeRepeated}
          onChange={(event) => onChange({ ...draft, smartWaitDedupeRepeated: event.target.checked })}
        />
        Deduplicar mensagens repetidas antes de responder
      </label>
    </div>
  );
}
