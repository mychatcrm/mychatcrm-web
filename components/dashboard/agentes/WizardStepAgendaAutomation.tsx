"use client";

import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";

export function WizardStepAgendaAutomation({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
      <Toggle
        id="agenda-automation-enabled"
        checked={draft.agendaAutomationEnabled}
        onChange={(value) => onChange({ ...draft, agendaAutomationEnabled: value })}
        label="Permitir criar, remarcar e cancelar agendamentos"
        description="O agente sempre consulta a agenda. Ative esta opção somente quando ele puder alterar compromissos durante a conversa."
      />
    </section>
  );
}
