"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";

function parsePositiveInt(raw: string, fallback: number, max: number) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return Math.min(max, Math.max(1, fallback));
  return Math.min(max, Math.max(1, n));
}

export function WizardStepFollowUpInteligente({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const f = draft.followUpInteligente ?? {
    ativo: false,
    tentativasContato: 3,
    intervaloVerificacaoMinutos: 60,
  };
  const setF = (patch: Partial<typeof f>) =>
    onChange({ ...draft, followUpInteligente: { ...f, ...patch } });

  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 divide-y divide-line rounded-xl border border-line bg-surface-elevated/20">
        <div className="px-3 py-4 sm:px-4">
          <Toggle
            id="follow-up-inteligente-ativo"
            checked={f.ativo}
            onChange={(ativo) => setF({ ativo })}
            label="Ativar Follow-up"
            description="Permite que o agente entre em contato novamente com clientes que não responderam. Com follow-up inteligente, o motor usa todo o histórico da conversa para retomar no assunto certo — sem frases prontas nem modelos fixos."
          />
        </div>
        <div className="px-3 py-4 sm:px-4">
          <p className="text-sm font-medium text-content">Tentativas de contato</p>
          <p className="mt-1 text-xs text-content-muted">
            Quantas vezes o agente tentará entrar em contato com clientes que não responderam
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={99}
              disabled={!f.ativo}
              value={f.tentativasContato}
              onChange={(event) =>
                setF({ tentativasContato: parsePositiveInt(event.target.value, f.tentativasContato, 99) })
              }
              className="w-[5.75rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">tentativas</span>
          </div>
        </div>
        <div className="px-3 py-4 sm:px-4">
          <p className="text-sm font-medium text-content">Intervalo de verificação</p>
          <p className="mt-1 text-xs text-content-muted">
            Intervalo de tempo para verificar o status das conversas (em minutos)
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={10080}
              disabled={!f.ativo}
              value={f.intervaloVerificacaoMinutos}
              onChange={(event) =>
                setF({
                  intervaloVerificacaoMinutos: parsePositiveInt(
                    event.target.value,
                    f.intervaloVerificacaoMinutos,
                    10080,
                  ),
                })
              }
              className="w-[5.75rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">minutos</span>
          </div>
        </div>
      </div>
    </div>
  );
}
