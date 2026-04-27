"use client";

import { Toggle } from "@/components/ui/Toggle";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { LeadAdsConnector } from "./LeadAdsConnector";
import type { AgentOrigin } from "@/lib/types";
import { getWizardOrigin, normalizeOrigensForWizard, type AgentWizardDraft } from "@/lib/agents";

function updateOrigin(draft: AgentWizardDraft, type: AgentOrigin["tipo"], patch: Partial<AgentOrigin>) {
  return normalizeOrigensForWizard(draft.origens).map((origin) =>
    origin.tipo === type ? ({ ...origin, ...patch } as AgentOrigin) : origin,
  );
}

export function WizardStep3Ativacao({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const leadAds = getWizardOrigin(draft, "lead_ads");
  const ctw = getWizardOrigin(draft, "ctw");

  return (
    <div className="min-w-0 space-y-4">
      <h3 className="text-base font-semibold text-content">Quando este agente deve ser acionado?</h3>

      <LeadAdsConnector
        enabled={leadAds.ativo}
        formIds={leadAds.config.formIds ?? []}
        delayFirst={leadAds.config.delayPrimeiro ?? 0}
        sendFirstMessage={leadAds.config.enviarPrimeiro ?? false}
        firstMessage={leadAds.config.mensagemInicial ?? ""}
        onToggle={(next) => onChange({ ...draft, origens: updateOrigin(draft, "lead_ads", { ativo: next }) })}
        onFormIdsChange={(next) =>
          onChange({
            ...draft,
            origens: updateOrigin(draft, "lead_ads", {
              config: { ...leadAds.config, formIds: next },
            }),
          })
        }
        onDelayChange={(next) =>
          onChange({
            ...draft,
            origens: updateOrigin(draft, "lead_ads", {
              config: { ...leadAds.config, delayPrimeiro: next },
            }),
          })
        }
        onSendFirstChange={(next) =>
          onChange({
            ...draft,
            origens: updateOrigin(draft, "lead_ads", {
              config: { ...leadAds.config, enviarPrimeiro: next },
            }),
          })
        }
        onFirstMessageChange={(next) =>
          onChange({
            ...draft,
            origens: updateOrigin(draft, "lead_ads", {
              config: { ...leadAds.config, mensagemInicial: next },
            }),
          })
        }
      />

      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <Toggle
          id="ctw-toggle"
          checked={ctw.ativo}
          onChange={(next) => onChange({ ...draft, origens: updateOrigin(draft, "ctw", { ativo: next }) })}
          label="Click to WhatsApp (anúncio com botão)"
        />
        {ctw.ativo ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-xl border border-line px-3 py-2 text-xs hover:bg-surface-elevated/50">
                Buscar anúncios ativos
              </button>
            </div>
            <Input
              value={(ctw.config.adIds ?? []).join(", ")}
              onChange={(event) =>
                onChange({
                  ...draft,
                  origens: updateOrigin(draft, "ctw", {
                    config: {
                      ...ctw.config,
                      adIds: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }),
                })
              }
              placeholder="IDs dos anúncios separados por vírgula"
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
