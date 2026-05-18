"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import type { AgentWizardDraft } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldTitle, InlineFieldTitle } from "./agent-field-help";

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
          <div className="flex items-start justify-between gap-4">
            <InlineFieldTitle title="Ativar Follow-up" help={AGENT_FIELD_HELP.followUpAtivar} />
            <button
              id="follow-up-inteligente-ativo"
              type="button"
              role="switch"
              aria-checked={f.ativo}
              onClick={() => setF({ ativo: !f.ativo })}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                f.ativo ? "border-primary/40 bg-gradient-primary" : "border-line/80 bg-surface-deep",
              )}
              aria-label="Ativar Follow-up"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-200 ease-out",
                  f.ativo ? "translate-x-[22px]" : "translate-x-[2px]",
                )}
              />
            </button>
          </div>
        </div>
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Tentativas de contato" help={AGENT_FIELD_HELP.followUpTentativas} className="mb-3" />
          <div className="flex flex-wrap items-center gap-2">
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
          <FieldTitle title="Intervalo de verificação" help={AGENT_FIELD_HELP.followUpIntervalo} className="mb-3" />
          <div className="flex flex-wrap items-center gap-2">
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
