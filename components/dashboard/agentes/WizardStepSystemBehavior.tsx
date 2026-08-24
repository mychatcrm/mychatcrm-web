"use client";

import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";

export function WizardStepSystemBehavior({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-xs leading-relaxed text-content-muted">
        O comportamento, a identidade e a transparência do agente vêm dos seus prompts. Opcionalmente, você pode
        mandar o sistema reforçar somente o campo de tom configurado. Regras técnicas de segurança e a mecânica da
        agenda continuam ativas sem acrescentar persona ou instruções comerciais.
      </p>

      <div className="space-y-4 rounded-xl border border-line bg-surface-card p-3.5 sm:p-4">
        <Toggle
          id="use-system-tone-instructions"
          checked={draft.useSystemToneInstructions}
          onChange={(v) => onChange({ ...draft, useSystemToneInstructions: v })}
          label="Frases automáticas de tom, velocidade e idioma"
          description="Converte o tom/velocidade/idioma escolhidos acima em instruções prontas no prompt. Desligado, essas escolhas continuam guardadas, mas o comportamento de tom precisa estar descrito nas suas próprias instruções."
        />
      </div>
    </div>
  );
}
