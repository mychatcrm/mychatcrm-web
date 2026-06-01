"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import type { AgentWizardDraft } from "@/lib/agents";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldTitle } from "./agent-field-help";

export function WizardStep4Fluxo({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
      <FieldTitle title="Número do atendente responsável" help={AGENT_FIELD_HELP.handoffNumero} className="mb-3" />
      <Input
        value={draft.handoffNumero}
        onChange={(event) => onChange({ ...draft, handoffNumero: event.target.value })}
        placeholder="5562999999999"
      />
    </section>
  );
}
