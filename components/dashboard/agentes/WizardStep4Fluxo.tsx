"use client";

import type { ReactNode } from "react";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";

const CTA_OPTIONS = [
  { value: "Agendar no Google Agenda", label: "Agendar uma reunião ou visita" },
  { value: "Enviar link de pagamento", label: "Enviar link de pagamento" },
  { value: "Transferir para humano", label: "Transferir para atendente humano" },
  { value: "Adicionar ao grupo", label: "Adicionar ao grupo do WhatsApp" },
  { value: "Enviar contrato", label: "Enviar contrato para assinatura" },
] as const;

function FieldHelp({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs leading-relaxed text-content-muted">{children}</p>;
}

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
          <h4 className="text-sm font-semibold text-content">Transferência para Atendente Humano</h4>
          <p className="mt-1 text-xs leading-relaxed text-content-muted">
            Quando ativado, o agente detecta quando o cliente quer falar com uma pessoa real e faz a
            transferência automaticamente.
          </p>
          <div className="mt-4">
            <Toggle
              id="handoff-ativo"
              checked={handoffActive}
              onChange={(v) => onChange({ ...draft, ctaHandoffAtivo: v })}
              label="Ativar transferência para humano"
            />
          </div>
        </div>

        <div className="px-3 py-4 sm:px-4">
          <p className="text-sm font-medium text-content">Palavras que ativam a transferência</p>
          <FieldHelp>
            Quando o cliente digitar qualquer uma dessas palavras, a transferência é acionada.
          </FieldHelp>
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
            className="mt-3"
          />
        </div>

        <div className="px-3 py-4 sm:px-4">
          <p className="text-sm font-medium text-content">Número do atendente responsável</p>
          <FieldHelp>
            Número do WhatsApp que receberá a notificação quando um cliente pedir atendimento humano.
            Use o formato: 5562999999999
          </FieldHelp>
          <Input
            disabled={!handoffActive}
            value={draft.handoffNumero}
            onChange={(event) => onChange({ ...draft, handoffNumero: event.target.value })}
            placeholder="5562999999999"
            className="mt-3"
          />
        </div>

        <div className="px-3 py-4 sm:px-4">
          <p className="text-sm font-medium text-content">Mensagem enviada ao cliente na transferência</p>
          <FieldHelp>O que o agente vai dizer ao cliente antes de transferir.</FieldHelp>
          <textarea
            disabled={!handoffActive}
            value={draft.handoffMensagem}
            onChange={(event) => onChange({ ...draft, handoffMensagem: event.target.value })}
            className="mt-3 min-h-[96px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-sm text-content outline-none disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Perfeito! Vou te conectar com nosso especialista agora. Um momento."
          />
        </div>
      </section>

      <section className="min-w-0 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
        <h4 className="text-sm font-semibold text-content">Objetivo Final do Agente (CTA)</h4>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Define qual é a ação final que o agente deve buscar durante a conversa.
        </p>
        <div className="mt-4">
          <p className="text-sm font-medium text-content">O que o agente deve conquistar?</p>
          <Select
            value={ctaValue}
            onChange={(event) => onChange({ ...draft, ctaFinal: event.target.value })}
            className="mt-3"
          >
            {CTA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </section>
    </div>
  );
}
