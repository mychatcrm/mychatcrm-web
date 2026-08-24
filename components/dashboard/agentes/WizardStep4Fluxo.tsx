"use client";

import { useState } from "react";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Toggle } from "@/components/ui/Toggle";
import type { AgentWizardDraft } from "@/lib/agents";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldTitle } from "./agent-field-help";

export function WizardStep4Fluxo({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const [keywordsText, setKeywordsText] = useState(() => draft.handoffKeywords.join(", "));

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-elevated/20 px-3 py-4 sm:px-4">
      <FieldTitle title="Transferência humana" help={AGENT_FIELD_HELP.handoffAtivar} className="mb-4" />
      <Toggle
        id="handoff-ativo"
        checked={draft.ctaHandoffAtivo}
        onChange={(value) => onChange({ ...draft, ctaHandoffAtivo: value })}
        label="Ativar transferência para humano"
      />
      <FieldTitle title="Número do atendente responsável" help={AGENT_FIELD_HELP.handoffNumero} className="mb-3 mt-5" />
      <Input
        disabled={!draft.ctaHandoffAtivo}
        value={draft.handoffNumero}
        onChange={(event) => onChange({ ...draft, handoffNumero: event.target.value })}
        placeholder="+14155552671"
      />
      <p className="mt-1.5 text-xs text-content-muted">
        Use o formato internacional, com código do país e DDD, sem depender de um país específico.
      </p>

      <label className="mb-2 mt-5 block text-sm font-medium text-content" htmlFor="handoff-mensagem">
        Mensagem enviada ao cliente
      </label>
      <textarea
        id="handoff-mensagem"
        disabled={!draft.ctaHandoffAtivo}
        value={draft.handoffMensagem}
        onChange={(event) => onChange({ ...draft, handoffMensagem: event.target.value })}
        placeholder="Escreva exatamente como o agente deve avisar que o atendimento será transferido."
        className="min-h-[92px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none disabled:cursor-not-allowed disabled:opacity-50"
        maxLength={1000}
      />

      <label className="mb-2 mt-5 block text-sm font-medium text-content" htmlFor="handoff-keywords">
        Palavras ou frases que pedem atendimento humano
      </label>
      <Input
        id="handoff-keywords"
        disabled={!draft.ctaHandoffAtivo}
        value={keywordsText}
        onChange={(event) => {
          const raw = event.target.value;
          setKeywordsText(raw);
          const keywords = raw
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 50);
          onChange({ ...draft, handoffKeywords: keywords });
        }}
        placeholder="Separe por vírgulas; deixe vazio para não usar palavras-chave adicionais"
      />
      <p className="mt-1.5 text-xs text-content-muted">
        Configure termos no idioma e no contexto deste agente. O campo é opcional.
      </p>
    </section>
  );
}
