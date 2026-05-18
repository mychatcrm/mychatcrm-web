"use client";

import { CheckCircle2 } from "lucide-react";
import { buildSimplePromptFromProFields, type AgentWizardDraft, type InstructionMode } from "@/lib/agents";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldLabel, FieldTitle } from "./agent-field-help";

const TEMP_MIN = 0.01;
const TEMP_MAX = 1;

export function WizardStep2Instructions({
  draft,
  onChange,
  onGeneratePrompt,
  promptSizeUnits,
  temperaturaClamped,
  temperaturaPct,
  isLight,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  onGeneratePrompt: () => void;
  promptSizeUnits: number;
  temperaturaClamped: number;
  temperaturaPct: number;
  isLight: boolean;
}) {
  const isSimpleMode = draft.instructionMode === "simple";

  const setInstructionMode = (mode: InstructionMode) => {
    if (mode === draft.instructionMode) return;
    if (mode === "simple") {
      const simplePrompt = draft.simplePrompt.trim()
        ? draft.simplePrompt
        : buildSimplePromptFromProFields(draft);
      onChange({ ...draft, instructionMode: "simple", simplePrompt });
      return;
    }
    onChange({ ...draft, instructionMode: "pro" });
  };

  return (
    <>
      <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <FieldTitle title="Modo de instruções" help={AGENT_FIELD_HELP.modoInstrucoes} className="mb-4" />
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setInstructionMode("simple")}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition",
              isSimpleMode
                ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                : "border-line bg-surface-elevated/30 hover:border-line/80 hover:bg-surface-elevated/50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-content">Simples</p>
              {isSimpleMode ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setInstructionMode("pro")}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition",
              !isSimpleMode
                ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                : "border-line bg-surface-elevated/30 hover:border-line/80 hover:bg-surface-elevated/50",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-content">Pro</p>
              {!isSimpleMode ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
            </div>
          </button>
        </div>
      </div>

      {isSimpleMode ? (
        <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
          <FieldLabel label="Prompt do agente" help={AGENT_FIELD_HELP.promptSimples} htmlFor="agent-simple-prompt" />
          <div className="relative mt-3">
            <textarea
              id="agent-simple-prompt"
              value={draft.simplePrompt}
              onChange={(event) => onChange({ ...draft, simplePrompt: event.target.value })}
              placeholder="Descreva aqui tudo sobre seu agente: quem ele é, como deve se comportar, o que pode e não pode dizer, qual é seu objetivo..."
              className="min-h-[300px] w-full resize-y rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 pb-8 text-sm text-content outline-none"
            />
            <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-content-muted">
              {draft.simplePrompt.length} caracteres
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <FieldTitle title="Identidade" help={AGENT_FIELD_HELP.identidade} className="mb-3" />
            <textarea
              value={draft.promptIdentidade}
              onChange={(event) => onChange({ ...draft, promptIdentidade: event.target.value })}
              placeholder='Ex.: Sou a assistente virtual da empresa X; falo em português claro, no «tu», e deixo explícito que sou um assistente automatizado quando couber.'
              className="min-h-[88px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
            />
          </div>

          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <FieldTitle title="Objetivo" help={AGENT_FIELD_HELP.objetivo} className="mb-3" />
            <textarea
              value={draft.promptObjetivo}
              onChange={(event) => onChange({ ...draft, promptObjetivo: event.target.value })}
              placeholder="Ex.: Converter visitantes do WhatsApp em reuniões agendadas com o time comercial, priorizando PMEs de serviços."
              className="min-h-[100px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
            />
          </div>

          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <FieldTitle title="Instruções" help={AGENT_FIELD_HELP.instrucoes} />
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <span className="text-xs text-content-faint">Tamanho do prompt (aprox.): {promptSizeUnits} unidades</span>
                <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onGeneratePrompt}>
                  Gerar com IA
                </Button>
              </div>
            </div>
            <textarea
              value={draft.systemPrompt}
              onChange={(event) => onChange({ ...draft, systemPrompt: event.target.value })}
              placeholder="Descreva como o agente deve conduzir a conversa, o que priorizar e quando pedir ajuda humana."
              className="mt-3 min-h-[180px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
            />
          </div>

          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <FieldTitle title="Regras adicionais" help={AGENT_FIELD_HELP.regrasAdicionais} className="mb-3" />
            <textarea
              value={draft.promptRegrasAdicionais}
              onChange={(event) => onChange({ ...draft, promptRegrasAdicionais: event.target.value })}
              placeholder="Ex.: Sempre confirmar cidade e segmento antes de enviar preço. Usar listas curtas com no máximo 3 itens."
              className="min-h-[100px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
            />
          </div>

          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <FieldTitle title="Respostas proibidas" help={AGENT_FIELD_HELP.respostasProibidas} className="mb-3" />
            <textarea
              value={draft.respostasProibidas}
              onChange={(event) => onChange({ ...draft, respostasProibidas: event.target.value })}
              placeholder="Não mencione concorrentes, não dê descontos acima de 5%..."
              className="min-h-[110px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
            />
          </div>

          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
              <FieldTitle title="Temperatura" help={AGENT_FIELD_HELP.temperatura} />
              <span className="w-fit shrink-0 rounded-full border border-line bg-surface-elevated px-3 py-1 text-sm font-semibold tabular-nums text-content">
                {Number(temperaturaClamped.toFixed(2))}
              </span>
            </div>
            <div className="mt-5 px-0.5">
              <div className="relative flex h-10 items-center">
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-line" />
                <div
                  className="pointer-events-none absolute left-0 top-1/2 h-2 max-w-full -translate-y-1/2 rounded-l-full bg-primary transition-[width] duration-75 ease-out"
                  style={{ width: `${temperaturaPct}%` }}
                />
                <div
                  className={cn(
                    "pointer-events-none absolute top-1/2 z-[1] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-[left] duration-75 ease-out",
                    isLight ? "border-line bg-white" : "border-white/20 bg-surface-elevated",
                  )}
                  style={{ left: `${temperaturaPct}%` }}
                />
                <input
                  type="range"
                  min={TEMP_MIN}
                  max={TEMP_MAX}
                  step={0.01}
                  value={temperaturaClamped}
                  aria-label="Temperatura do modelo"
                  onChange={(event) => {
                    const v = Number(event.target.value);
                    onChange({ ...draft, temperatura: Math.min(TEMP_MAX, Math.max(TEMP_MIN, v)) });
                  }}
                  className="absolute inset-0 z-[2] w-full cursor-pointer opacity-0"
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] tabular-nums text-content-muted">
                <span>{TEMP_MIN}</span>
                <span>{TEMP_MAX}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
