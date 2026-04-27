"use client";

import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";

export function LeadAdsConnector({
  enabled,
  formIds,
  delayFirst,
  sendFirstMessage,
  firstMessage,
  onToggle,
  onFormIdsChange,
  onDelayChange,
  onSendFirstChange,
  onFirstMessageChange,
}: {
  enabled: boolean;
  formIds: string[];
  delayFirst: number;
  sendFirstMessage: boolean;
  firstMessage: string;
  onToggle: (next: boolean) => void;
  onFormIdsChange: (next: string[]) => void;
  onDelayChange: (next: number) => void;
  onSendFirstChange: (next: boolean) => void;
  onFirstMessageChange: (next: string) => void;
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
      <Toggle id="lead-ads-toggle" checked={enabled} onChange={onToggle} label="Lead Ads (formulário Meta)" />
      {enabled ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm">
              Conectar com Meta
            </Button>
            <Button variant="secondary" size="sm">
              Buscar formulários ativos
            </Button>
          </div>
          <Input
            value={formIds.join(", ")}
            onChange={(event) =>
              onFormIdsChange(
                event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            placeholder="IDs de formulário separados por vírgula"
          />
          <Toggle
            id="lead-ads-first-message"
            checked={sendFirstMessage}
            onChange={onSendFirstChange}
            label="Agente envia primeira mensagem automaticamente"
          />
          <Select value={`${delayFirst}`} onChange={(event) => onDelayChange(Number(event.target.value))}>
            <option value="0">Imediato</option>
            <option value="1">1 minuto</option>
            <option value="5">5 minutos</option>
            <option value="15">15 minutos</option>
          </Select>
          <textarea
            value={firstMessage}
            onChange={(event) => onFirstMessageChange(event.target.value)}
            placeholder="Mensagem inicial com variáveis: {{nome}}, {{email}}, {{campo_1}}..."
            className="min-h-[110px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
          />
        </div>
      ) : null}
    </section>
  );
}
