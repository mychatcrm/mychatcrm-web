"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect } from "@/components/panel/ui/PanelSelect";
import type { AgentWizardDraft } from "@/lib/agents";
import { COMMON_TIMEZONES } from "@/lib/agents/common-timezones";
import { cn } from "@/lib/utils";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldLabel } from "./agent-field-help";
import { AGENT_AVATAR_OPTIONS } from "./agent-avatar-icons";

export function WizardStep1Identidade({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 md:gap-4">
      <div className="md:col-span-2">
        <FieldLabel label="Nome do agente" help={AGENT_FIELD_HELP.nome} />
        <Input value={draft.nome} onChange={(event) => onChange({ ...draft, nome: event.target.value })} placeholder="Carlos - Suporte Técnico" />
      </div>
      <div className="min-w-0 rounded-xl bg-surface-elevated/25 p-3">
        <FieldLabel label="Cor do agente" help={AGENT_FIELD_HELP.cor} />
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <input
            type="color"
            value={draft.cor}
            onChange={(event) => onChange({ ...draft, cor: event.target.value })}
            className="h-11 w-14 shrink-0 rounded-xl border border-line bg-transparent"
          />
          <span className="min-w-0 break-all text-xs text-content-muted">{draft.cor}</span>
        </div>
      </div>
      <div className="min-w-0 rounded-xl bg-surface-elevated/25 p-3">
        <FieldLabel label="Avatar" help={AGENT_FIELD_HELP.avatar} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(2.75rem,2.75rem))] gap-2">
          {AGENT_AVATAR_OPTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange({ ...draft, avatar: id })}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl border text-content-secondary transition",
                draft.avatar === id ? "border-primary bg-primary/15 text-primary" : "border-line bg-surface-card hover:border-primary/30",
              )}
              aria-label={`Avatar ${label}`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 md:col-span-2">
        <FieldLabel
          label="Fuso horário"
          help="Define o fuso usado na data/hora do prompt do agente e na janela de horário do follow-up."
        />
        <PanelSelect
          value={draft.timezone ?? "America/Sao_Paulo"}
          onChange={(e) => {
            const timezone = e.target.value;
            onChange({
              ...draft,
              timezone,
              followUpInteligente: { ...draft.followUpInteligente, timezone },
            });
          }}
          className="w-full max-w-full sm:max-w-sm"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </PanelSelect>
      </div>
    </div>
  );
}
