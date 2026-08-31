"use client";

import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
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

const MENSAGEM_FORA_JANELA_MAX = 400;

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
          { offsetValor: 1, offsetUnidade: "dias", mensagem: "" },
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
              <div className="space-y-4 pl-1">
                {/* Dias da semana */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-content-secondary">Dias da semana disponíveis</p>
                  <div className="flex flex-wrap gap-2">
                    {DIAS_SEMANA.map(({ value, label }) => {
                      const active = disp.diasSemana.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleDia(value)}
                          aria-pressed={active}
                          className={[
                            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                            active
                              ? "border border-primary bg-primary text-white shadow-sm"
                              : "border border-line bg-surface-card/50 text-content-secondary hover:border-primary/40 hover:text-content",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] text-content-muted">
                    Dias em laranja estão selecionados. O agente só aceita agendamentos nesses dias.
                  </p>
                </div>

                {/* Horários */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-content-secondary">Horário início</label>
                    <input
                      type="time"
                      value={disp.horaInicio}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          agendaDisponibilidade: { ...disp, horaInicio: e.target.value },
                        })
                      }
                      className="rounded-md border border-line bg-surface-card px-2 py-1 text-sm text-content focus:border-primary focus:outline-none"
                    />
                  </div>
                  <span className="mt-4 text-content-secondary">até</span>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-content-secondary">Horário fim</label>
                    <input
                      type="time"
                      value={disp.horaFim}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          agendaDisponibilidade: { ...disp, horaFim: e.target.value },
                        })
                      }
                      className="rounded-md border border-line bg-surface-card px-2 py-1 text-sm text-content focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Mensagem para horário fora da janela */}
                <div className="space-y-1">
                  <label className="text-xs text-content-secondary" htmlFor="agenda-mensagem-fora-janela">
                    Mensagem para horário fora da janela
                  </label>
                  <p className="text-[11px] leading-relaxed text-content-muted">
                    Enviada quando o cliente pede um horário fora dos dias/horários acima. Escreva o
                    texto no idioma e no tom definidos para este agente; o sistema não cria uma
                    mensagem genérica.
                  </p>
                  <textarea
                    id="agenda-mensagem-fora-janela"
                    rows={3}
                    maxLength={MENSAGEM_FORA_JANELA_MAX}
                    value={disp.mensagemForaJanela ?? ""}
                    placeholder="Mensagem configurada pelo operador"
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        agendaDisponibilidade: { ...disp, mensagemForaJanela: e.target.value },
                      })
                    }
                    className="w-full resize-none rounded-md border border-line bg-surface-card px-2 py-1.5 text-sm text-content placeholder:text-content-muted focus:border-primary focus:outline-none"
                  />
                  <p className="text-right text-[11px] text-content-muted">
                    {(disp.mensagemForaJanela ?? "").length}/{MENSAGEM_FORA_JANELA_MAX}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ─── Agendamentos simultâneos ────────────────────────────────── */}
          <div className="space-y-3 border-t border-line pt-4">
            <Toggle
              id="agenda-simultaneos"
              checked={disp.permitirAgendamentosSimultaneos !== false}
              onChange={(value) =>
                onChange({
                  ...draft,
                  agendaDisponibilidade: { ...disp, permitirAgendamentosSimultaneos: value },
                })
              }
              label="Permitir múltiplos agendamentos no mesmo horário"
              description="Quando desativado, o agente recusa horários que já têm outro evento ativo na agenda (incluindo eventos criados manualmente e sincronizados do Google) e sugere alternativas."
            />
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
                    className="rounded-lg border border-line bg-surface-card p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-content-secondary">
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
                      <label className="text-xs text-content-secondary whitespace-nowrap">Enviar</label>
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
                        className="w-16 rounded-md border border-line bg-surface-elevated px-2 py-1 text-sm text-content focus:border-primary focus:outline-none"
                      />
                      <select
                        value={regra.offsetUnidade}
                        onChange={(e) =>
                          updateLembrete(idx, {
                            offsetUnidade: e.target.value as AgentAgendaLembreteRegra["offsetUnidade"],
                          })
                        }
                        className="rounded-md border border-line bg-surface-elevated px-2 py-1 text-sm text-content focus:border-primary focus:outline-none"
                      >
                        <option value="minutos">minuto(s)</option>
                        <option value="horas">hora(s)</option>
                        <option value="dias">dia(s)</option>
                      </select>
                      <span className="text-xs text-content-secondary whitespace-nowrap">antes</span>
                    </div>

                    {/* Mensagem */}
                    <div className="space-y-1">
                      <label className="text-xs text-content-secondary">
                        Mensagem{" "}
                        <span className="text-content-muted">
                          — variáveis: {"{nome}"} {"{data}"} {"{hora}"} {"{local}"}
                        </span>
                      </label>
                      <textarea
                        rows={2}
                        value={regra.mensagem ?? ""}
                        placeholder="Escreva a mensagem exatamente como o agente deve enviá-la."
                        onChange={(e) => updateLembrete(idx, { mensagem: e.target.value })}
                        className="w-full resize-none rounded-md border border-line bg-surface-elevated px-2 py-1.5 text-sm text-content placeholder:text-content-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                ))}

                {lembretes.regras.length < 3 && (
                  <button
                    type="button"
                    onClick={addLembrete}
                    className="text-xs text-primary hover:underline"
                  >
                    + Adicionar lembrete
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ─── Movimento do card no CRM ────────────────────────────────── */}
          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <p className="text-sm font-medium text-content">Mover o card no CRM</p>
              <p className="mt-0.5 text-xs text-content-muted">
                Opcional. Quando o agendamento acontece ou é cancelado, o card do lead vai
                sozinho para a coluna escolhida — inclusive quando alguém cancela pelo painel
                da Agenda.
              </p>
            </div>

            <AgendaCrmTargetPicker
              idPrefix="agenda-crm-schedule"
              label="Ao agendar"
              description="Card vai para esta coluna quando o agente confirma ou remarca um compromisso."
              enabled={draft.agendaCrmMoveOnScheduleEnabled}
              funnelId={draft.agendaCrmScheduleFunnelId}
              columnId={draft.agendaCrmScheduleColumnId}
              onChange={(patch) => onChange({ ...draft, ...patch })}
              keys={{
                enabled: "agendaCrmMoveOnScheduleEnabled",
                funnelId: "agendaCrmScheduleFunnelId",
                columnId: "agendaCrmScheduleColumnId",
              }}
            />

            <AgendaCrmTargetPicker
              idPrefix="agenda-crm-cancel"
              label="Ao cancelar"
              description="Card vai para esta coluna quando o agendamento é cancelado, pela conversa ou pelo painel."
              enabled={draft.agendaCrmMoveOnCancelEnabled}
              funnelId={draft.agendaCrmCancelFunnelId}
              columnId={draft.agendaCrmCancelColumnId}
              onChange={(patch) => onChange({ ...draft, ...patch })}
              keys={{
                enabled: "agendaCrmMoveOnCancelEnabled",
                funnelId: "agendaCrmCancelFunnelId",
                columnId: "agendaCrmCancelColumnId",
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Toggle + par funil/coluna. Os dois destinos da agenda (agendar e cancelar)
 * são independentes e usam este mesmo controle.
 */
function AgendaCrmTargetPicker({
  idPrefix,
  label,
  description,
  enabled,
  funnelId,
  columnId,
  onChange,
  keys,
}: {
  idPrefix: string;
  label: string;
  description: string;
  enabled: boolean;
  funnelId: string;
  columnId: string;
  onChange: (patch: Partial<AgentWizardDraft>) => void;
  keys: {
    enabled: "agendaCrmMoveOnScheduleEnabled" | "agendaCrmMoveOnCancelEnabled";
    funnelId: "agendaCrmScheduleFunnelId" | "agendaCrmCancelFunnelId";
    columnId: "agendaCrmScheduleColumnId" | "agendaCrmCancelColumnId";
  };
}) {
  const { funnels } = useCrmFunnels();
  const selectedFunnel = funnels.find((f) => f.id === funnelId) ?? funnels[0];
  const stageOptions = selectedFunnel?.columns ?? [];
  const selectedColumn = stageOptions.some((c) => c.id === columnId)
    ? columnId
    : (stageOptions[0]?.id ?? "");

  return (
    <div className="space-y-3">
      <Toggle
        id={`${idPrefix}-enabled`}
        checked={enabled}
        onChange={(value) =>
          onChange(
            value
              ? {
                  [keys.enabled]: true,
                  [keys.funnelId]: selectedFunnel?.id ?? funnelId,
                  [keys.columnId]: selectedColumn,
                }
              : { [keys.enabled]: false },
          )
        }
        label={label}
        description={description}
      />

      {enabled && (
        <div className="grid min-w-0 gap-3 rounded-xl border border-line bg-surface-deep/40 p-3 pl-1 sm:grid-cols-2 sm:pl-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-content-secondary">Funil</p>
            <Select
              value={selectedFunnel?.id ?? ""}
              onChange={(event) => {
                const funnel = funnels.find((f) => f.id === event.target.value);
                if (!funnel) return;
                onChange({
                  [keys.funnelId]: funnel.id,
                  [keys.columnId]: funnel.columns[0]?.id ?? "",
                });
              }}
            >
              {funnels.map((funnel) => (
                <option key={funnel.id} value={funnel.id}>
                  {funnel.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-content-secondary">Coluna de destino</p>
            <Select
              key={selectedFunnel?.id ?? "no-funnel"}
              value={selectedColumn}
              onChange={(event) => onChange({ [keys.columnId]: event.target.value })}
            >
              {stageOptions.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
