"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";

export function WizardStep4Fluxo({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <Toggle
          id="cta-handoff-ativo"
          checked={draft.ctaHandoffAtivo}
          onChange={(v) => onChange({ ...draft, ctaHandoffAtivo: v })}
          label="Definir CTA e handoff aqui"
          description="Desligado por padrão. Ative só se quiser estes campos além das instruções; o texto gerado a partir do negócio usa isto apenas quando estiver ativo."
        />
      </section>

      {draft.ctaHandoffAtivo ? (
        <section className="grid min-w-0 gap-3 rounded-xl border border-line bg-surface-card p-3 sm:p-4 md:grid-cols-2">
          <div>
            <label className="text-xs text-content-faint">CTA final do agente</label>
            <Select value={draft.ctaFinal} onChange={(event) => onChange({ ...draft, ctaFinal: event.target.value })}>
              <option>Agendar no Google Agenda</option>
              <option>Enviar link de pagamento</option>
              <option>Transferir para humano</option>
              <option>Adicionar ao grupo</option>
              <option>Enviar contrato</option>
            </Select>
          </div>
          <div>
            <label className="text-xs text-content-faint">Número do humano responsável</label>
            <Input value={draft.handoffNumero} onChange={(event) => onChange({ ...draft, handoffNumero: event.target.value })} placeholder="+55 62 9 9999-0000" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-content-faint">Palavras que disparam handoff</label>
            <Input
              value={draft.handoffKeywords.join(", ")}
              onChange={(event) =>
                onChange({
                  ...draft,
                  handoffKeywords: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              placeholder="humano, atendente, falar com pessoa"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-content-faint">Mensagem de transição</label>
            <textarea
              value={draft.handoffMensagem}
              onChange={(event) => onChange({ ...draft, handoffMensagem: event.target.value })}
              className="mt-1 min-h-[90px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-sm text-content outline-none"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
