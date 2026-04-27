"use client";

import { useMemo } from "react";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import type { AgentWizardDraft } from "@/lib/agents";

export function WizardStep5Funil({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const { funnels } = useCrmFunnels();
  const funnelForDraft = useMemo(
    () => funnels.find((f) => f.id === draft.funil.funilId) ?? funnels[0],
    [funnels, draft.funil.funilId],
  );
  const stageOptions = funnelForDraft?.columns ?? [];

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div>
        <label className="text-xs text-content-faint">Funil</label>
        <Select
          value={draft.funil.funilId}
          onChange={(event) => {
            const id = event.target.value;
            const row = funnels.find((f) => f.id === id);
            if (!row) return;
            onChange({
              ...draft,
              funil: {
                ...draft.funil,
                funilId: row.id,
                nomeFunil: row.nome,
                colunaInicial: row.columns[0]?.id ?? draft.funil.colunaInicial,
              },
            });
          }}
        >
          {funnels.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="text-xs text-content-faint">Coluna</label>
        <Select
          key={draft.funil.funilId}
          value={
            stageOptions.some((c) => c.id === draft.funil.colunaInicial)
              ? draft.funil.colunaInicial
              : (stageOptions[0]?.id ?? "")
          }
          onChange={(event) => onChange({ ...draft, funil: { ...draft.funil, colunaInicial: event.target.value } })}
        >
          {stageOptions.map((col) => (
            <option key={col.id} value={col.id}>
              {col.title}
            </option>
          ))}
        </Select>
      </div>
      </div>

      <div>
        <label className="text-xs text-content-faint">Tags automáticas (separadas por vírgula)</label>
        <p className="mt-0.5 text-[11px] text-content-muted">Opcional — aplicadas ao lead quando entra neste funil/coluna.</p>
        <Input
          value={draft.funil.tagsEntrada.join(", ")}
          onChange={(event) =>
            onChange({
              ...draft,
              funil: {
                ...draft.funil,
                tagsEntrada: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
            })
          }
          placeholder="ex.: whatsapp, agente-clara, inbound"
          className="mt-2"
        />
      </div>
    </div>
  );
}
