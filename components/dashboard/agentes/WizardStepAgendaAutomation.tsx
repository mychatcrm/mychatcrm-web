"use client";

import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";
import type { AgentAgendaLembreteRegra } from "@/lib/types";

const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

const DEFAULT_LEMBRETE_MENSAGEM =
  "Olá {nome}, lembrete do seu agendamento em {data} às {hora}. Local: {local}.";

export function WizardStepAgendaAutomation({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const lembretes = draft.agendaLembretes;
  const disp = draft.agendaDisponibilidade;

  function updateLembrete(idx: number, patch: Partial<AgentAgendaLembreteRegra>) {
    const novas = lembretes.regras.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange({ ...draft, agendaLembretes: { ...lembretes, regras: novas } });
  }

  function addLembrete() {
    if (lembretes.regras.length >= 3) return;
    onChange({
      ...draft,
      agendaLembretes: {
        ...lembretes,
        regras: [
          ...lembretes.regras,
          { offsetValor: 1, offsetUnidade: "dias", mensagem: DEFAULT_LEMBRETE_MENSAGEM },
        ],
      },
    });
  }

  function removeLembrete(idx: number) {
    onChange({
      ...draft,
      agendaLembretes: {
        ...lembretes,
        regras: lembretes.regras.filter((_, i) => i !== idx),
      },
    });
  }

  function toggleDia(dia: number) {
    const atual = disp.diasSemana;
    const novos = atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia].sort((a, b) => a - b);
    onChange({ ...draft, agendaDisponibilidade: { ...disp, diasSemana: novos } });
  }

  return (
    <section className="min-w-0 space-y-6 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
      {/* Toggle principal */}
      <Toggle
        id="agenda-automation-enabled"
        checked={draft.agendaAutomationEnabled}
        onChange={(value) => onChange({ ...draft, agendaAutomationEnabled: value })}
        label="Permitir criar, remarcar e cancelar agendamentos"
        description="O agente sempre consulta a agenda. Ative esta opção somente quando ele puder alterar compromissos durante a conversa."
      />

      {draft.agendaAutomationEnabled && (
        <>
          {/* ─── Disponibilidade ─────────────────────────────────────────── */}
          <div className="space-y-3 border-t border-line pt-4">
            <Toggle
              id="agenda-disponibilidade-ativo"
              checked={disp.ativo}
              onChange={(value) =>
                onChange({ ...draft, agendaDisponibilidade: { ...disp, ativo: value } })
              }
              label="Restringir horários de agendamento"
              description="Define os dias da semana e horários em que o agente pode aceitar agendamentos."
            />

            {disp.ativo && (
              <div className="space-y-3 pl-1">
                {/* Dias da semana */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-text-secondary">Dias da semana disponíveis</p>
                  <div className="flex flex-wrap gap-2">
                    {DIAS_SEMANA.map(({ value, label }) => {
                      const active = disp.diasSemana.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleDia(value)}
                          className={[
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            active
                              ? "bg-brand-orange text-white"
                              : "bg-surface border border-line text-text-secondary hover:border-brand-orange/50",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Horários */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">Horário início</label>
                    <input
                      type="time"
                      value={disp.horaInicio}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          agendaDisponibilidade: { ...disp, horaInicio: e.target.value },
                        })
                      }
                      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-text-primary focus:border-brand-orange focus:outline-none"
                    />
                  </div>
                  <span className="mt-4 text-text-secondary">até</span>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-text-secondary">Horário fim</label>
                    <input
                      type="time"
                      value={disp.horaFim}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          agendaDisponibilidade: { ...disp, horaFim: e.target.value },
                        })
                      }
                      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-text-primary focus:border-brand-orange focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── Lembretes ───────────────────────────────────────────────── */}
          <div className="space-y-3 border-t border-line pt-4">
            <Toggle
              id="agenda-lembretes-ativo"
              checked={lembretes.ativo}
              onChange={(value) =>
                onChange({ ...draft, agendaLembretes: { ...lembretes, ativo: value } })
              }
              label="Lembretes automáticos de agendamento"
              description="Envia mensagens automáticas para o cliente antes do horário marcado (ex.: 1 dia antes, 1 semana antes)."
            />

            {lembretes.ativo && (
              <div className="space-y-3 pl-1">
                {lembretes.regras.map((regra, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-line bg-surface p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-secondary">
                        Lembrete {idx + 1}
                      </span>
                      {lembretes.regras.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLembrete(idx)}
                          className="text-xs text-red-500 hover:text-red-600"
                        >
                          Remover
                        </button>
                      )}
                    </div>

                    {/* Offset */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-text-secondary whitespace-nowrap">Enviar</label>
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={regra.offsetValor}
                        onChange={(e) =>
                          updateLembrete(idx, {
                            offsetValor: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="w-16 rounded-md border border-line bg-surface-elevated px-2 py-1 text-sm text-text-primary focus:border-brand-orange focus:outline-none"
                      />
                      <select
                        value={regra.offsetUnidade}
                        onChange={(e) =>
                          updateLembrete(idx, {
                            offsetUnidade: e.target.value as AgentAgendaLembreteRegra["offsetUnidade"],
                          })
                        }
                        className="rounded-md border border-line bg-surface-elevated px-2 py-1 text-sm text-text-primary focus:border-brand-orange focus:outline-none"
                      >
                        <option value="minutos">minuto(s)</option>
                        <option value="horas">hora(s)</option>
                        <option value="dias">dia(s)</option>
                      </select>
                      <span className="text-xs text-text-secondary whitespace-nowrap">antes</span>
                    </div>

                    {/* Mensagem */}
                    <div className="space-y-1">
                      <label className="text-xs text-text-secondary">
                        Mensagem{" "}
                        <span className="text-text-tertiary">
                          — variáveis: {"{nome}"} {"{data}"} {"{hora}"} {"{local}"}
                        </span>
                      </label>
                      <textarea
                        rows={2}
                        value={regra.mensagem ?? ""}
                        placeholder={DEFAULT_LEMBRETE_MENSAGEM}
                        onChange={(e) => updateLembrete(idx, { mensagem: e.target.value })}
                        className="w-full resize-none rounded-md border border-line bg-surface-elevated px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand-orange focus:outline-none"
                      />
                    </div>
                  </div>
                ))}

                {lembretes.regras.length < 3 && (
                  <button
                    type="button"
                    onClick={addLembrete}
                    className="text-xs text-brand-orange hover:underline"
                  >
                    + Adicionar lembrete
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
