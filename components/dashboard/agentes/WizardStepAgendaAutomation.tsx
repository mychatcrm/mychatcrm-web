"use client";

import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";
import { DEFAULT_AGENDA_LEMBRETES } from "@/lib/agents/wizard-model";
import type { AgentAgendaLembreteRegra } from "@/lib/types";

const EXAMPLE_MESSAGES = [
  "Olá {nome}, passando para lembrar do seu agendamento amanhã às {hora}.",
  "Olá {nome}, seu agendamento é hoje às {hora}, no local {local}.",
];

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
        <div className="space-y-4 border-t border-line pt-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Lembretes de agendamento</h3>
            <p className="text-xs text-muted">
              Follow-up exclusivo da agenda, separado do follow-up de lead parado. Só vale para leads
              com compromisso confirmado pelo agente.
            </p>
          </div>

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
            label="Ativar lembretes de agendamento"
            description="Envia até 3 mensagens antes do horário do compromisso (pipeline agenda_reminder_jobs)."
          />

          {lembretes.ativo ? (
            <div className="space-y-3">
              {lembretes.regras.slice(0, 3).map((regra, index) => (
                <div
                  key={`agenda-lembrete-${index}`}
                  className="space-y-2 rounded-lg border border-line/70 bg-surface/40 p-3"
                >
                  <p className="text-xs font-medium text-foreground">Lembrete {index + 1}</p>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={1}
                        className="w-20 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                        value={regra.offsetValor}
                        onChange={(e) =>
                          updateRegra(index, {
                            offsetValor: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        aria-label={`Antecedência valor lembrete ${index + 1}`}
                      />
                      <select
                        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                        value={regra.offsetUnidade}
                        onChange={(e) =>
                          updateRegra(index, {
                            offsetUnidade: e.target.value as AgentAgendaLembreteRegra["offsetUnidade"],
                          })
                        }
                        aria-label={`Antecedência unidade lembrete ${index + 1}`}
                      >
                        <option value="minutos">minutos antes</option>
                        <option value="horas">horas antes</option>
                        <option value="dias">dias antes</option>
                      </select>
                    </div>
                    <textarea
                      rows={2}
                      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm sm:col-span-2"
                      placeholder={EXAMPLE_MESSAGES[index] ?? EXAMPLE_MESSAGES[0]}
                      value={regra.mensagem ?? ""}
                      onChange={(e) => updateRegra(index, { mensagem: e.target.value })}
                      aria-label={`Mensagem lembrete ${index + 1}`}
                    />
                  </div>
                  <p className="text-[11px] text-muted">
                    Variáveis: {"{nome}"}, {"{data}"}, {"{hora}"}, {"{local}"}, {"{titulo}"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
