"use client";

import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";
import { DEFAULT_AGENDA_LEMBRETES } from "@/lib/agents/wizard-model";
import type { AgentAgendaLembreteRegra } from "@/lib/types";

export function WizardStepAgendaAutomation({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const lembretes = draft.agendaLembretes ?? DEFAULT_AGENDA_LEMBRETES;

  const updateRegra = (index: number, patch: Partial<AgentAgendaLembreteRegra>) => {
    const regras = lembretes.regras.map((regra, i) =>
      i === index ? { ...regra, ...patch } : regra,
    );
    onChange({ ...draft, agendaLembretes: { ...lembretes, regras } });
  };

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
      <Toggle
        id="agenda-automation-enabled"
        checked={draft.agendaAutomationEnabled}
        onChange={(value) => onChange({ ...draft, agendaAutomationEnabled: value })}
        label="Permitir criar, remarcar e cancelar agendamentos"
        description="O agente sempre consulta a agenda. Ative esta opção somente quando ele puder alterar compromissos durante a conversa."
      />

      {draft.agendaAutomationEnabled ? (
        <div className="space-y-3 border-t border-line pt-4">
          <Toggle
            id="agenda-lembretes-ativo"
            checked={lembretes.ativo}
            onChange={(value) =>
              onChange({
                ...draft,
                agendaLembretes: {
                  ...lembretes,
                  ativo: value,
                  regras: lembretes.regras.length
                    ? lembretes.regras
                    : DEFAULT_AGENDA_LEMBRETES.regras,
                },
              })
            }
            label="Enviar lembretes de agendamento"
            description="Pipeline separado do follow-up de lead parado. Mensagens são enviadas antes do horário do compromisso."
          />

          {lembretes.ativo ? (
            <div className="space-y-3">
              {lembretes.regras.slice(0, 3).map((regra, index) => (
                <div
                  key={`agenda-lembrete-${index}`}
                  className="grid gap-2 rounded-lg border border-line/70 bg-surface/40 p-3 sm:grid-cols-[88px_1fr]"
                >
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                      value={regra.offsetValor}
                      onChange={(e) =>
                        updateRegra(index, { offsetValor: Math.max(1, Number(e.target.value) || 1) })
                      }
                      aria-label={`Antecedência valor ${index + 1}`}
                    />
                    <select
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                      value={regra.offsetUnidade}
                      onChange={(e) =>
                        updateRegra(index, {
                          offsetUnidade: e.target.value as AgentAgendaLembreteRegra["offsetUnidade"],
                        })
                      }
                      aria-label={`Antecedência unidade ${index + 1}`}
                    >
                      <option value="minutos">min</option>
                      <option value="horas">h</option>
                      <option value="dias">dias</option>
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                    placeholder="Mensagem opcional. Use {titulo}, {data}, {hora}, {local}"
                    value={regra.mensagem ?? ""}
                    onChange={(e) => updateRegra(index, { mensagem: e.target.value })}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
