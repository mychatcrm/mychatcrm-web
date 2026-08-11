"use client";

import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import type { AgentWizardDraft } from "@/lib/agents";
import type { AgentLeadOutcomeConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { FieldLabel, InlineFieldTitle } from "./agent-field-help";

const EMPTY: AgentLeadOutcomeConfig = {
  ativo: false,
  criterios: "",
  funnelId: null,
  columnId: null,
  retomarAoVoltar: false,
  notificar: false,
};

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        checked ? "border-primary/40 bg-primary" : "border-line/80 bg-surface-deep",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-200 ease-out",
          checked ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

function ToggleRow({
  title,
  help,
  checked,
  onChange,
}: {
  title: string;
  help: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-card px-3 py-3 sm:px-4">
      <InlineFieldTitle title={title} help={help} />
      <ToggleSwitch checked={checked} onChange={() => onChange(!checked)} label={title} />
    </div>
  );
}

/**
 * Uma das duas automações de descarte. Ordem deliberada: primeiro o que
 * caracteriza o desfecho no negócio do cliente, depois para onde o card vai, e
 * só então as opções de comportamento. Sem os critérios o resto não faz sentido.
 */
function OutcomeBlock({
  titulo,
  descricao,
  exemploPlaceholder,
  config,
  funnels,
  help,
  onChange,
}: {
  titulo: string;
  descricao: string;
  exemploPlaceholder: string;
  config: AgentLeadOutcomeConfig;
  funnels: ReturnType<typeof useCrmFunnels>["funnels"];
  help: {
    ativar: string;
    criterios: string;
    funil: string;
    coluna: string;
    retomar: string;
    notificar: string;
  };
  onChange: (next: AgentLeadOutcomeConfig) => void;
}) {
  const patch = (values: Partial<AgentLeadOutcomeConfig>) => onChange({ ...config, ...values });

  // Sem escolha gravada, mostra o primeiro funil — mas o valor só é persistido
  // quando o operador confirma ligando a automação, e a validação do wizard
  // exige funil e coluna válidos antes de salvar.
  const selectedFunnel = funnels.find((f) => f.id === config.funnelId) ?? funnels[0];
  const stageOptions = selectedFunnel?.columns ?? [];
  const selectedColumn = stageOptions.some((c) => c.id === config.columnId)
    ? (config.columnId ?? "")
    : (stageOptions[0]?.id ?? "");

  return (
    <section className="min-w-0 space-y-4">
      <div>
        <p className="text-sm font-semibold text-content">{titulo}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{descricao}</p>
      </div>

      <ToggleRow
        title="Ativar esta automação"
        help={help.ativar}
        checked={config.ativo}
        // Ao ligar, grava o destino que a tela já está mostrando: sem isso o
        // operador veria um funil selecionado e o wizard recusaria salvar.
        onChange={(ativo) =>
          patch(
            ativo
              ? {
                  ativo,
                  funnelId: config.funnelId ?? selectedFunnel?.id ?? null,
                  columnId: config.columnId ?? selectedColumn ?? null,
                }
              : { ativo },
          )
        }
      />

      {config.ativo ? (
        <div className="min-w-0 space-y-4">
          <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
            <FieldLabel label="O que caracteriza este desfecho no seu negócio" help={help.criterios} />
            <textarea
              value={config.criterios}
              onChange={(event) => patch({ criterios: event.target.value })}
              placeholder={exemploPlaceholder}
              className="mt-3 min-h-[120px] w-full resize-y rounded-xl border border-line bg-surface-elevated/35 px-3 py-3 text-sm text-content outline-none"
            />
            <p className="mt-2 text-xs leading-relaxed text-content-muted">
              Obrigatório. O agente só encerra o atendimento com base no que você escrever aqui — sem
              isso ele não tem regra nenhuma para decidir.
            </p>
          </div>

          <div className="grid min-w-0 gap-4 rounded-xl border border-line bg-surface-deep/40 p-4 sm:grid-cols-2">
            <div>
              <FieldLabel label="Funil de destino" help={help.funil} />
              <Select
                className="mt-2"
                value={selectedFunnel?.id ?? ""}
                onChange={(event) => {
                  const funnel = funnels.find((f) => f.id === event.target.value);
                  if (!funnel) return;
                  patch({ funnelId: funnel.id, columnId: funnel.columns[0]?.id ?? null });
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
              <FieldLabel label="Coluna/etapa de destino" help={help.coluna} />
              <Select
                key={selectedFunnel?.id ?? "no-funnel"}
                className="mt-2"
                value={selectedColumn}
                onChange={(event) =>
                  patch({
                    funnelId: selectedFunnel?.id ?? config.funnelId,
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

          <ToggleRow
            title="Se o lead voltar a falar, o agente retoma sozinho"
            help={help.retomar}
            checked={config.retomarAoVoltar}
            onChange={(retomarAoVoltar) => patch({ retomarAoVoltar })}
          />
          <ToggleRow
            title="Avisar o atendente no WhatsApp"
            help={help.notificar}
            checked={config.notificar}
            onChange={(notificar) => patch({ notificar })}
          />
        </div>
      ) : null}
    </section>
  );
}

export function WizardStepLeadOutcome({
  draft,
  onChange,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const { funnels } = useCrmFunnels();

  return (
    <div className="min-w-0 space-y-6">
      <div className="rounded-xl border border-line bg-surface-deep/40 p-3 text-xs leading-relaxed text-content-muted sm:p-4">
        Diferente das outras automações do CRM, estas <strong className="text-content">encerram o
        atendimento</strong> do lead: o card muda de coluna, o agente para de responder e nenhum
        follow-up é enviado. A conversa continua visível em Conversas com o motivo registrado, e
        qualquer pessoa da equipe pode reativar o agente por lá.
      </div>

      <OutcomeBlock
        titulo="1. Lead desqualificado"
        descricao="Para quem não atende os requisitos do que você oferece."
        exemploPlaceholder="Descreva com suas palavras o que desqualifica alguém no seu negócio — região que você não atende, perfil que não se encaixa, requisito obrigatório que a pessoa não cumpre…"
        config={draft.leadOutcomeDisqualified ?? EMPTY}
        funnels={funnels}
        help={{
          ativar: AGENT_FIELD_HELP.descarteDesqualificadoAtivar,
          criterios: AGENT_FIELD_HELP.descarteDesqualificadoCriterios,
          funil: AGENT_FIELD_HELP.descarteDesqualificadoFunil,
          coluna: AGENT_FIELD_HELP.descarteDesqualificadoColuna,
          retomar: AGENT_FIELD_HELP.descarteRetomar,
          notificar: AGENT_FIELD_HELP.descarteNotificar,
        }}
        onChange={(leadOutcomeDisqualified) => onChange({ ...draft, leadOutcomeDisqualified })}
      />

      <div className="border-t border-line/60 pt-6">
        <OutcomeBlock
          titulo="2. Lead sem interesse"
          descricao="Para quem desistiu do que procurava. Coluna própria, separada da desqualificação."
          exemploPlaceholder="Descreva o que conta como desistência de verdade no seu caso — e lembre que 'agora não' ou 'me chama depois' não é desistência…"
          config={draft.leadOutcomeLostInterest ?? EMPTY}
          funnels={funnels}
          help={{
            ativar: AGENT_FIELD_HELP.descarteSemInteresseAtivar,
            criterios: AGENT_FIELD_HELP.descarteSemInteresseCriterios,
            funil: AGENT_FIELD_HELP.descarteSemInteresseFunil,
            coluna: AGENT_FIELD_HELP.descarteSemInteresseColuna,
            retomar: AGENT_FIELD_HELP.descarteRetomar,
            notificar: AGENT_FIELD_HELP.descarteNotificar,
          }}
          onChange={(leadOutcomeLostInterest) => onChange({ ...draft, leadOutcomeLostInterest })}
        />
      </div>
    </div>
  );
}
