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

function parseHour(raw: string, fallback: number) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 23) return fallback;
  return n;
}

const WEEK_DAYS = [
  { label: "Dom", value: 0 },
  { label: "Seg", value: 1 },
  { label: "Ter", value: 2 },
  { label: "Qua", value: 3 },
  { label: "Qui", value: 4 },
  { label: "Sex", value: 5 },
  { label: "Sáb", value: 6 },
];

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
    modo: "moderado" as const,
    cooldownMinutos: 60,
    slaHorasResposta: null,
    horaInicio: 8,
    horaFim: 18,
    diasAtivos: [1, 2, 3, 4, 5],
    retomadaApenasSeHumanoAbandonou: false,
  };
  const setF = (patch: Partial<typeof f>) =>
    onChange({ ...draft, followUpInteligente: { ...f, ...patch } });

  const toggleDay = (day: number) => {
    const current = f.diasAtivos ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setF({ diasAtivos: next });
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 divide-y divide-line rounded-xl border border-line bg-surface-elevated/20">

        {/* Toggle */}
        <div className="px-3 py-4 sm:px-4">
          <div className="flex items-start justify-between gap-4">
            <InlineFieldTitle title="Ativar Follow-up Inteligente" help={AGENT_FIELD_HELP.followUpAtivar} />
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
              aria-label="Ativar Follow-up Inteligente"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-200 ease-out",
                  f.ativo ? "translate-x-[22px]" : "translate-x-[2px]",
                )}
              />
            </button>
          </div>
          {f.ativo && (
            <p className="mt-2 text-xs leading-relaxed text-content-muted">
              O agente retomará conversas paradas usando o histórico real — sem mensagens genéricas. Respeita horário comercial, cooldown e atendimento humano.
            </p>
          )}
        </div>

        {/* Modo */}
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Modo de abordagem" help={AGENT_FIELD_HELP.followUpModo} className="mb-3" />
          <div className="grid grid-cols-3 gap-2">
            {(["suave", "moderado", "agressivo"] as const).map((modo) => (
              <button
                key={modo}
                type="button"
                disabled={!f.ativo}
                onClick={() => setF({ modo })}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-colors",
                  f.modo === modo && f.ativo
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-line bg-surface-base text-content-muted hover:border-line/60 hover:text-content",
                  !f.ativo && "cursor-not-allowed opacity-50",
                )}
              >
                {modo === "suave" ? "Suave" : modo === "moderado" ? "Moderado" : "Agressivo"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-content-muted">
            {f.modo === "suave"
              ? "Gentil — mostra disponibilidade sem pressão."
              : f.modo === "moderado"
                ? "Equilibrado — retoma com contexto sem insistir."
                : "Direto — cria urgência legítima e pede próximo passo."}
          </p>
        </div>

        {/* Tentativas e intervalo */}
        <div className="grid gap-4 px-3 py-4 sm:grid-cols-2 sm:px-4">
          <div>
            <FieldTitle title="Tentativas de contato" help={AGENT_FIELD_HELP.followUpTentativas} className="mb-3" />
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                max={99}
                disabled={!f.ativo}
                value={f.tentativasContato}
                onChange={(e) =>
                  setF({ tentativasContato: parsePositiveInt(e.target.value, f.tentativasContato, 99) })
                }
                className="w-[5.75rem] min-h-10 shrink-0 py-2"
              />
              <span className="text-sm text-content-muted">tentativas</span>
            </div>
          </div>
          <div>
            <FieldTitle title="Intervalo entre tentativas" help={AGENT_FIELD_HELP.followUpIntervalo} className="mb-3" />
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={60}
                max={10080}
                disabled={!f.ativo}
                value={f.intervaloVerificacaoMinutos}
                onChange={(e) =>
                  setF({
                    intervaloVerificacaoMinutos: parsePositiveInt(
                      e.target.value,
                      f.intervaloVerificacaoMinutos,
                      10080,
                    ),
                  })
                }
                className="w-[5.75rem] min-h-10 shrink-0 py-2"
              />
              <span className="text-sm text-content-muted">min</span>
            </div>
          </div>
        </div>

        {/* Cooldown anti-spam */}
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Cooldown mínimo entre follow-ups" help={AGENT_FIELD_HELP.followUpCooldown} className="mb-3" />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={30}
              max={10080}
              disabled={!f.ativo}
              value={f.cooldownMinutos ?? 60}
              onChange={(e) =>
                setF({ cooldownMinutos: parsePositiveInt(e.target.value, f.cooldownMinutos ?? 60, 10080) })
              }
              className="w-[5.75rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">min (anti-spam)</span>
          </div>
        </div>

        {/* SLA */}
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="SLA de resposta" help={AGENT_FIELD_HELP.followUpSla} className="mb-3" />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={168}
                disabled={!f.ativo || !f.slaHorasResposta}
                value={f.slaHorasResposta ?? ""}
                placeholder="—"
                onChange={(e) =>
                  setF({
                    slaHorasResposta: e.target.value
                      ? parsePositiveInt(e.target.value, 24, 168)
                      : null,
                  })
                }
                className="w-[5.75rem] min-h-10 shrink-0 py-2"
              />
              <span className="text-sm text-content-muted">horas sem resposta = SLA violado</span>
            </div>
            {f.slaHorasResposta && (
              <button
                type="button"
                disabled={!f.ativo}
                onClick={() => setF({ slaHorasResposta: null })}
                className="text-xs text-content-muted underline hover:text-content"
              >
                desativar SLA
              </button>
            )}
          </div>
        </div>

        {/* Horário comercial */}
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Janela comercial (UTC)" help={AGENT_FIELD_HELP.followUpHorario} className="mb-3" />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={0}
              max={23}
              disabled={!f.ativo}
              value={f.horaInicio ?? 8}
              onChange={(e) =>
                setF({ horaInicio: parseHour(e.target.value, f.horaInicio ?? 8) })
              }
              className="w-[4.5rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">às</span>
            <Input
              type="number"
              min={1}
              max={23}
              disabled={!f.ativo}
              value={f.horaFim ?? 18}
              onChange={(e) =>
                setF({ horaFim: parseHour(e.target.value, f.horaFim ?? 18) })
              }
              className="w-[4.5rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">h (UTC). Fora desse horário o envio é adiado.</span>
          </div>
        </div>

        {/* Dias ativos */}
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Dias permitidos" help={AGENT_FIELD_HELP.followUpDias} className="mb-3" />
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => {
              const active = (f.diasAtivos ?? []).includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  disabled={!f.ativo}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "h-9 w-12 rounded-lg border text-xs font-medium transition-colors",
                    active && f.ativo
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-line bg-surface-base text-content-muted hover:border-line/60 hover:text-content",
                    !f.ativo && "cursor-not-allowed opacity-50",
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-content-muted">
            Nenhum selecionado = todos os dias.
          </p>
        </div>

        {/* Retomada apenas se humano abandonou */}
        <div className="px-3 py-4 sm:px-4">
          <div className="flex items-start justify-between gap-4">
            <InlineFieldTitle
              title="Retomar só se humano abandonou"
              help={AGENT_FIELD_HELP.followUpSoHumano}
            />
            <button
              type="button"
              role="switch"
              aria-checked={f.retomadaApenasSeHumanoAbandonou}
              disabled={!f.ativo}
              onClick={() =>
                setF({
                  retomadaApenasSeHumanoAbandonou: !f.retomadaApenasSeHumanoAbandonou,
                })
              }
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                f.retomadaApenasSeHumanoAbandonou && f.ativo
                  ? "border-primary/40 bg-gradient-primary"
                  : "border-line/80 bg-surface-deep",
                !f.ativo && "cursor-not-allowed opacity-50",
              )}
              aria-label="Retomar só se humano abandonou"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-200 ease-out",
                  f.retomadaApenasSeHumanoAbandonou && f.ativo
                    ? "translate-x-[22px]"
                    : "translate-x-[2px]",
                )}
              />
            </button>
          </div>
          <p className="mt-1.5 text-xs text-content-muted">
            Quando ativado, o agente só faz follow-up se um atendente humano estava na conversa e não deu continuidade.
          </p>
        </div>

      </div>
    </div>
  );
}
