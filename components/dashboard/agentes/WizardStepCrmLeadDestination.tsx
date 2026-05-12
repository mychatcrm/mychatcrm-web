"use client";

import { useMemo } from "react";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import type { AgentWizardDraft } from "@/lib/agents";
import { cn } from "@/lib/utils";

export function WizardStepCrmLeadDestination({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const { funnels } = useCrmFunnels();
  const selectedFunnel = useMemo(
    () => funnels.find((f) => f.id === draft.crmTargetFunnelId) ?? funnels[0],
    [funnels, draft.crmTargetFunnelId],
  );
  const stageOptions = selectedFunnel?.columns ?? [];
  const selectedColumn = stageOptions.some((c) => c.id === draft.crmTargetColumnId)
    ? draft.crmTargetColumnId
    : (stageOptions[0]?.id ?? "");

  const setMode = (enabled: boolean) => {
    if (!enabled) {
      onChange({
        ...draft,
        crmAutoMoveEnabled: false,
      });
      return;
    }

    onChange({
      ...draft,
      crmAutoMoveEnabled: true,
      crmTargetFunnelId: selectedFunnel?.id ?? draft.crmTargetFunnelId,
      crmTargetColumnId: selectedColumn,
    });
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          {
            value: false,
            title: "Não mover no CRM",
            description: "Cria ou atualiza o lead sem alterar funil/coluna.",
          },
          {
            value: true,
            title: "Mover para funil/coluna específica",
            description: "Sempre posiciona o lead no destino definido abaixo.",
          },
        ].map((option) => {
          const active = draft.crmAutoMoveEnabled === option.value;
          return (
            <button
              key={option.title}
              type="button"
              onClick={() => setMode(option.value)}
              className={cn(
                "rounded-xl border px-4 py-3 text-left transition",
                active
                  ? "border-primary/45 bg-primary/10 text-content shadow-sm"
                  : "border-line bg-surface-card text-content-secondary hover:border-primary/30 hover:bg-surface-elevated/40",
              )}
            >
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-content-muted">{option.description}</span>
            </button>
          );
        })}
      </div>

      {draft.crmAutoMoveEnabled ? (
        <div className="grid min-w-0 gap-4 rounded-xl border border-line bg-surface-deep/40 p-4 sm:grid-cols-2">
          <div>
            <label className="text-xs text-content-faint">Funil de destino</label>
            <Select
              className="mt-2"
              value={selectedFunnel?.id ?? ""}
              onChange={(event) => {
                const funnel = funnels.find((f) => f.id === event.target.value);
                if (!funnel) return;
                onChange({
                  ...draft,
                  crmAutoMoveEnabled: true,
                  crmTargetFunnelId: funnel.id,
                  crmTargetColumnId: funnel.columns[0]?.id ?? "",
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
            <label className="text-xs text-content-faint">Coluna/etapa de destino</label>
            <Select
              key={selectedFunnel?.id ?? "no-funnel"}
              className="mt-2"
              value={selectedColumn}
              onChange={(event) =>
                onChange({
                  ...draft,
                  crmAutoMoveEnabled: true,
                  crmTargetFunnelId: selectedFunnel?.id ?? draft.crmTargetFunnelId,
                  crmTargetColumnId: event.target.value,
                })
              }
            >
              {stageOptions.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-content-muted">
        A regra é aplicada no backend somente para leads do mesmo tenant e quando a conversa tiver um agente identificado.
      </p>
    </div>
  );
}
