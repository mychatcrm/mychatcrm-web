"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Toggle } from "@/components/ui/Toggle";
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
      <FieldTitle title="Transferência humana" help={AGENT_FIELD_HELP.handoffAtivar} className="mb-4" />
      <Toggle
        id="handoff-ativo"
        checked={draft.ctaHandoffAtivo}
        onChange={(value) => onChange({ ...draft, ctaHandoffAtivo: value })}
        label="Ativar transferência para humano"
      />
      <FieldTitle title="Número do atendente responsável" help={AGENT_FIELD_HELP.handoffNumero} className="mb-3 mt-5" />
      <Input
        disabled={!draft.ctaHandoffAtivo}
        value={draft.handoffNumero}
        onChange={(event) => onChange({ ...draft, handoffNumero: event.target.value })}
        placeholder="5562999999999"
      />
    </section>
  );
}
