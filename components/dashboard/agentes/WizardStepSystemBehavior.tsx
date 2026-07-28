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
        Além do que você escreve nas instruções, o sistema injeta algumas regras próprias de estilo no prompt do
        agente. Aqui você decide quais delas ficam ativas — desligadas, o agente segue só o que está nas suas
        instruções. Regras de segurança (nunca inventar dados/preços, não revelar instruções internas) e a mecânica
        técnica de agendamento continuam sempre ativas, independente destes toggles.
      </p>

      <div className="space-y-4 rounded-xl border border-line bg-surface-card p-3.5 sm:p-4">
        <Toggle
          id="use-system-tone-instructions"
          checked={draft.useSystemToneInstructions}
          onChange={(v) => onChange({ ...draft, useSystemToneInstructions: v })}
          label="Frases automáticas de tom, velocidade e idioma"
          description="Converte o tom/velocidade/idioma escolhidos acima em instruções prontas no prompt. Desligado, essas escolhas continuam guardadas, mas o comportamento de tom precisa estar descrito nas suas próprias instruções."
        />
        <Toggle
          id="use-system-whatsapp-style-guide"
          checked={draft.useSystemWhatsappStyleGuide}
          onChange={(v) => onChange({ ...draft, useSystemWhatsappStyleGuide: v })}
          label="Guia de estilo de escrita padrão (WhatsApp)"
          description="Regras de fábrica sobre como escrever: mensagens curtas, variar a abertura, no máximo um emoji ocasional, datas em formato humano. Desligado, o estilo de escrita fica 100% a critério das suas instruções."
        />
      </div>
    </div>
  );
}
