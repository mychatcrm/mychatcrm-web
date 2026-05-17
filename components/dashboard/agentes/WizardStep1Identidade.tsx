"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import type { AgentWizardDraft } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { AGENT_AVATAR_OPTIONS } from "./agent-avatar-icons";

export function WizardStep1Identidade({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="text-xs text-content-faint">Nome do agente</label>
        <Input value={draft.nome} onChange={(event) => onChange({ ...draft, nome: event.target.value })} placeholder="Carlos - Suporte Técnico" />
      </div>
      <div>
        <label className="text-xs text-content-faint">Gênero da IA</label>
        <Select value={draft.genero} onChange={(event) => onChange({ ...draft, genero: event.target.value as AgentWizardDraft["genero"] })}>
          <option value="feminino">Feminino</option>
          <option value="masculino">Masculino</option>
          <option value="neutro">Neutro</option>
        </Select>
      </div>
      <div className="min-w-0">
        <label className="text-xs text-content-faint">Cor do agente</label>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <input
            type="color"
            value={draft.cor}
            onChange={(event) => onChange({ ...draft, cor: event.target.value })}
            className="h-11 w-14 shrink-0 rounded-lg border border-line bg-transparent"
          />
          <span className="min-w-0 break-all text-xs text-content-muted">{draft.cor}</span>
        </div>
      </div>
      <div>
        <label className="text-xs text-content-faint">Avatar</label>
        <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
