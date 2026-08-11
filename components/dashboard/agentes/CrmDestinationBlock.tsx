"use client";

import { useMemo } from "react";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import { cn } from "@/lib/utils";
import { FieldLabel, InlineFieldTitle } from "./agent-field-help";

type CrmFunnel = ReturnType<typeof useCrmFunnels>["funnels"][number];

/**
 * Um destino de CRM: liga/desliga + funil + coluna.
 *
 * O agente tem vários momentos que podem mover o card (primeiro contato,
 * resposta do lead, disparo de follow-up, esgotamento, retorno depois de
 * esgotado) e todos têm exatamente esta mecânica com campos diferentes — por
 * isso o bloco mora num arquivo próprio, usado pelos passos de CRM e de
 * Follow-up do wizard.
 *
 * Nunca escolhe nada sozinho: chega desligado e o destino só é gravado quando
 * o dono do agente liga e seleciona.
 */
export function CrmDestinationBlock({
  funnels,
  enabled,
  funnelId,
  columnId,
  help,
  onChange,
}: {
  funnels: CrmFunnel[];
  enabled: boolean;
  funnelId: string;
  columnId: string;
  help: {
    off: string;
    on: string;
    funnel: string;
    column: string;
    offTitle: string;
    onTitle: string;
  };
  onChange: (next: { enabled: boolean; funnelId: string; columnId: string }) => void;
}) {
  const selectedFunnel = useMemo(
    () => funnels.find((f) => f.id === funnelId) ?? funnels[0],
    [funnels, funnelId],
  );
  const stageOptions = selectedFunnel?.columns ?? [];
  const selectedColumn = stageOptions.some((c) => c.id === columnId)
    ? columnId
    : (stageOptions[0]?.id ?? "");

  const setMode = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      onChange({ enabled: false, funnelId, columnId });
      return;
    }
    onChange({
      enabled: true,
      funnelId: selectedFunnel?.id ?? funnelId,
      columnId: selectedColumn,
    });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { value: false, title: help.offTitle, help: help.off },
          { value: true, title: help.onTitle, help: help.on },
        ].map((option) => {
          const active = enabled === option.value;
          return (
            <button
              key={option.title}
              type="button"
              onClick={() => setMode(option.value)}
              className={cn(
                "rounded-xl border px-4 py-3 text-left transition",
                active
                  ? "border-primary/45 bg-primary/10 text-content"
                  : "border-line bg-surface-card text-content-secondary hover:border-primary/30 hover:bg-surface-elevated/40",
              )}
            >
              <InlineFieldTitle title={option.title} help={option.help} />
            </button>
          );
        })}
      </div>

      {enabled ? (
        <div className="grid min-w-0 gap-4 rounded-xl border border-line bg-surface-deep/40 p-4 sm:grid-cols-2">
          <div>
            <FieldLabel label="Funil de destino" help={help.funnel} />
            <Select
              className="mt-2"
              value={selectedFunnel?.id ?? ""}
              onChange={(event) => {
                const funnel = funnels.find((f) => f.id === event.target.value);
                if (!funnel) return;
                onChange({
                  enabled: true,
                  funnelId: funnel.id,
                  columnId: funnel.columns[0]?.id ?? "",
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
            <FieldLabel label="Coluna/etapa de destino" help={help.column} />
            <Select
              key={selectedFunnel?.id ?? "no-funnel"}
              className="mt-2"
              value={selectedColumn}
              onChange={(event) =>
                onChange({
                  enabled: true,
                  funnelId: selectedFunnel?.id ?? funnelId,
                  columnId: event.target.value,
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
    </>
  );
}
