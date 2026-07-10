"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { PanelHelp } from "@/components/panel/ui/PanelHelp";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import {
  createActiveOfferFromApi,
  previewActiveOfferFromApi,
  type ActiveOfferPreviewResult,
  type ActiveOfferSummary,
} from "@/lib/crm-active-offers-client";
import type { ActiveOfferDistributionMode, ActiveOfferFilterInput } from "@/lib/active-offers-types";
import type { TeamEmployee } from "@/lib/team-employees-types";
import { cn } from "@/lib/utils";
import { ACTIVE_OFFERS_HELP } from "./active-offers-help";
import { FieldLabelWithHelp } from "./FieldLabelWithHelp";

const INACTIVITY_PRESETS = [
  { label: "Qualquer prazo", value: "" },
  { label: "30+ dias sem contato", value: "30" },
  { label: "90+ dias sem contato", value: "90" },
  { label: "180+ dias sem contato", value: "180" },
  { label: "365+ dias sem contato (≈ 1 ano)", value: "365" },
];

const STEPS = [
  { key: "filter" as const, label: "Quem entra na lista", help: ACTIVE_OFFERS_HELP.passoFiltrar },
  { key: "preview" as const, label: "Conferir quantidade", help: ACTIVE_OFFERS_HELP.passoPreview },
  { key: "distribute" as const, label: "Quem vai ligar", help: ACTIVE_OFFERS_HELP.passoDistribuir },
];

type Step = (typeof STEPS)[number]["key"];

export function DirectorOfferBuilder({
  employees,
  onCreated,
}: {
  employees: TeamEmployee[];
  onCreated: (offer: ActiveOfferSummary) => void;
}) {
  const { funnels } = useCrmFunnels();
  const [step, setStep] = useState<Step>("filter");
  const [title, setTitle] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [inactivityDays, setInactivityDays] = useState("");
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [assignAllSellers, setAssignAllSellers] = useState(true);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [distributionMode, setDistributionMode] = useState<ActiveOfferDistributionMode>("shared_pool");
  const [preview, setPreview] = useState<ActiveOfferPreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sellers = useMemo(
    () => employees.filter((e) => e.ativo && e.hierarchyRole === "seller"),
    [employees],
  );

  const allStages = useMemo(() => {
    const map = new Map<string, string>();
    for (const funnel of funnels) {
      for (const col of funnel.columns) map.set(col.id, col.title);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [funnels]);

  const filterPayload = useMemo((): ActiveOfferFilterInput => {
    const minDays = inactivityDays ? Number(inactivityDays) : null;
    return {
      kanbanStages: selectedStages.length ? selectedStages : undefined,
      minDaysInactive: Number.isFinite(minDays) ? minDays : null,
      ownerEmployeeIds: selectedOwners.length ? selectedOwners : undefined,
      includeUnassigned,
      excludeOptOut: true,
    };
  }, [selectedStages, inactivityDays, selectedOwners, includeUnassigned]);

  useEffect(() => {
    if (!title.trim()) {
      const date = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      setTitle(`Lista de ligação - ${date}`);
    }
  }, [title]);

  const toggleStage = (stageId: string) => {
    setSelectedStages((prev) => (prev.includes(stageId) ? prev.filter((id) => id !== stageId) : [...prev, stageId]));
  };

  const toggleOwner = (ownerId: string) => {
    setSelectedOwners((prev) => (prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]));
  };

  const toggleAssignee = (employeeId: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    );
  };

  const runPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await previewActiveOfferFromApi(filterPayload);
      setPreview(result);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao conferir quantidade.");
    } finally {
      setBusy(false);
    }
  }, [filterPayload]);

  const runCreate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const assigneeEmployeeIds = assignAllSellers ? [] : selectedAssignees;
      const offer = await createActiveOfferFromApi({
        title: title.trim(),
        filter: filterPayload,
        assigneeEmployeeIds,
        distributionMode,
      });
      onCreated(offer);
      setStep("filter");
      setPreview(null);
      setSelectedStages([]);
      setInactivityDays("");
      setSelectedOwners([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar lista.");
    } finally {
      setBusy(false);
    }
  }, [assignAllSellers, selectedAssignees, title, filterPayload, distributionMode, onCreated]);

  return (
    <div className="rounded-xl border border-line bg-surface-elevated/20 p-4">
      <div className="mb-4 flex flex-wrap gap-2">
        {STEPS.map((s, index) => (
          <span
            key={s.key}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
              step === s.key ? "bg-primary/15 text-primary" : "bg-surface-card text-content-muted",
            )}
          >
            {index + 1}. {s.label}
            <PanelHelp content={s.help} />
          </span>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-500">
          {error}
        </div>
      ) : null}

      {step === "filter" ? (
        <div className="space-y-4">
          <FieldLabelWithHelp
            label="Etapas do CRM"
            help={ACTIVE_OFFERS_HELP.etapasCrm}
            hint="Dica: combine “Perdido” + 365 dias para reativar base antiga."
          />
          <div className="flex flex-wrap gap-2">
            {allStages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition",
                  selectedStages.includes(stage.id)
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-line bg-surface-card text-content-muted hover:border-primary/25",
                )}
                onClick={() => toggleStage(stage.id)}
              >
                {stage.label}
              </button>
            ))}
          </div>

          <FieldLabelWithHelp
            label="Tempo sem contato"
            htmlFor="offer-inactivity"
            help={ACTIVE_OFFERS_HELP.diasSemContato}
          />
          <Select
            id="offer-inactivity"
            value={inactivityDays}
            onChange={(e) => setInactivityDays(e.target.value)}
          >
            {INACTIVITY_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </Select>

          <FieldLabelWithHelp
            label="Responsável atual"
            help={ACTIVE_OFFERS_HELP.responsavel}
            hint="Deixe vazio para incluir leads de todos os vendedores."
          />
          <div className="flex flex-wrap gap-2">
            {sellers.map((seller) => (
              <button
                key={seller.id}
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition",
                  selectedOwners.includes(seller.id)
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-line bg-surface-card text-content-muted hover:border-primary/25",
                )}
                onClick={() => toggleOwner(seller.id)}
              >
                {seller.nome}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              checked={includeUnassigned}
              onChange={(e) => setIncludeUnassigned(e.target.checked)}
            />
            Incluir leads sem responsável
            <PanelHelp content={ACTIVE_OFFERS_HELP.semResponsavel} />
          </label>

          <Button type="button" disabled={busy} onClick={() => void runPreview()}>
            {busy ? "Calculando..." : "Ver quantos leads encontrou"}
          </Button>
        </div>
      ) : null}

      {step === "preview" && preview ? (
        <div className="space-y-4">
          <FieldLabelWithHelp label="Quantidade encontrada" help={ACTIVE_OFFERS_HELP.preview} />
          <p className="text-sm text-content">
            <span className="font-semibold text-primary">{preview.matchCount.toLocaleString("pt-BR")}</span> contatos
            encontrados
            {preview.cappedCount < preview.matchCount
              ? ` (até ${preview.cappedCount.toLocaleString("pt-BR")} entrarão na lista)`
              : null}
          </p>
          <div className="space-y-2">
            {preview.sampleLeads.map((lead) => (
              <div key={lead.id} className="rounded-lg border border-line bg-surface-card px-3 py-2 text-sm">
                <p className="font-medium text-content">{lead.nome}</p>
                <p className="text-content-muted">
                  {lead.telefone} · {lead.status} ·{" "}
                  {lead.daysSinceContact != null ? `${lead.daysSinceContact} dias sem contato` : "Sem histórico"}
                </p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep("filter")}>
              Voltar
            </Button>
            <Button type="button" onClick={() => setStep("distribute")}>
              Continuar — quem vai ligar
            </Button>
          </div>
        </div>
      ) : null}

      {step === "distribute" ? (
        <div className="space-y-4">
          <FieldLabelWithHelp
            label="Nome da lista"
            htmlFor="offer-title"
            help={ACTIVE_OFFERS_HELP.tituloLista}
          />
          <Input id="offer-title" value={title} onChange={(e) => setTitle(e.target.value)} />

          <FieldLabelWithHelp label="Quem pode ligar" help={ACTIVE_OFFERS_HELP.vendedores} />
          <label className="flex items-center gap-2 text-sm text-content-muted">
            <input type="radio" checked={assignAllSellers} onChange={() => setAssignAllSellers(true)} />
            Todos os vendedores da equipe
            <PanelHelp content={ACTIVE_OFFERS_HELP.vendedoresTodos} />
          </label>
          <label className="flex items-center gap-2 text-sm text-content-muted">
            <input type="radio" checked={!assignAllSellers} onChange={() => setAssignAllSellers(false)} />
            Apenas vendedores selecionados
            <PanelHelp content={ACTIVE_OFFERS_HELP.vendedoresEscolhidos} />
          </label>
          {!assignAllSellers ? (
            <div className="flex flex-wrap gap-2">
              {sellers.map((seller) => (
                <button
                  key={seller.id}
                  type="button"
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm transition",
                    selectedAssignees.includes(seller.id)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-line bg-surface-card text-content-muted",
                  )}
                  onClick={() => toggleAssignee(seller.id)}
                >
                  {seller.nome}
                </button>
              ))}
            </div>
          ) : null}

          <FieldLabelWithHelp
            label="Como organizar a fila"
            htmlFor="offer-distribution"
            help={ACTIVE_OFFERS_HELP.modoDistribuicao}
          />
          <Select
            id="offer-distribution"
            value={distributionMode}
            onChange={(e) => setDistributionMode(e.target.value as ActiveOfferDistributionMode)}
          >
            <option value="shared_pool">Fila compartilhada — todos pegam o próximo</option>
            <option value="split_evenly">Dividir contatos entre vendedores</option>
          </Select>
          <div className="flex items-center gap-1.5 text-xs text-content-muted">
            <span>
              {distributionMode === "shared_pool"
                ? "Todos veem a mesma fila."
                : "Cada vendedor recebe uma parte fixa."}
            </span>
            <PanelHelp
              content={
                distributionMode === "shared_pool"
                  ? ACTIVE_OFFERS_HELP.modoFilaCompartilhada
                  : ACTIVE_OFFERS_HELP.modoDividirIgual
              }
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep("preview")}>
              Voltar
            </Button>
            <Button type="button" disabled={busy || !title.trim()} onClick={() => void runCreate()}>
              {busy ? "Criando..." : "Criar lista de ligação"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
