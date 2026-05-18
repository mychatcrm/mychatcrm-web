"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldTitle } from "./agent-field-help";

const CTA_OPTIONS = [
  { value: "Agendar no Google Agenda", label: "Agendar uma reunião ou visita" },
  { value: "Enviar link de pagamento", label: "Enviar link de pagamento" },
  { value: "Transferir para humano", label: "Transferir para atendente humano" },
  { value: "Adicionar ao grupo", label: "Adicionar ao grupo do WhatsApp" },
  { value: "Enviar contrato", label: "Enviar contrato para assinatura" },
] as const;

export function WizardStep4Fluxo({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const handoffActive = draft.ctaHandoffAtivo;
  const ctaValue = CTA_OPTIONS.some((opt) => opt.value === draft.ctaFinal)
    ? draft.ctaFinal
    : CTA_OPTIONS[2]!.value;

  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0 divide-y divide-line rounded-xl border border-line bg-surface-elevated/20">
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Transferência para Atendente Humano" help={AGENT_FIELD_HELP.handoffAtivar} className="mb-4" />
          <Toggle
            id="handoff-ativo"
            checked={handoffActive}
            onChange={(v) => onChange({ ...draft, ctaHandoffAtivo: v })}
            label="Ativar transferência para humano"
          />
        </div>

        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Palavras que ativam a transferência" help={AGENT_FIELD_HELP.handoffKeywords} className="mb-3" />
          <Input
            disabled={!handoffActive}
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

        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Número do atendente responsável" help={AGENT_FIELD_HELP.handoffNumero} className="mb-3" />
          <Input
            disabled={!handoffActive}
            value={draft.handoffNumero}
            onChange={(event) => onChange({ ...draft, handoffNumero: event.target.value })}
            placeholder="5562999999999"
          />
        </div>

        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Mensagem enviada ao cliente na transferência" help={AGENT_FIELD_HELP.handoffMensagem} className="mb-3" />
          <textarea
            disabled={!handoffActive}
            value={draft.handoffMensagem}
            onChange={(event) => onChange({ ...draft, handoffMensagem: event.target.value })}
            className="min-h-[96px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-sm text-content outline-none disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Perfeito! Vou te conectar com nosso especialista agora. Um momento."
          />
        </div>
      </section>

      <section className="min-w-0 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
        <FieldTitle title="Objetivo Final do Agente (CTA)" help={AGENT_FIELD_HELP.ctaFinal} className="mb-4" />
        <Select value={ctaValue} onChange={(event) => onChange({ ...draft, ctaFinal: event.target.value })}>
          {CTA_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </section>
    </div>
  );
}
