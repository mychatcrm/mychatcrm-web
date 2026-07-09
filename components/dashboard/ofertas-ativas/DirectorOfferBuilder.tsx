"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
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

const INACTIVITY_PRESETS = [
  { label: "Qualquer prazo", value: "" },
  { label: "30+ dias sem contato", value: "30" },
  { label: "90+ dias sem contato", value: "90" },
  { label: "180+ dias sem contato", value: "180" },
  { label: "365+ dias sem contato", value: "365" },
];

type Step = "filter" | "preview" | "distribute";

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
      setError(err instanceof Error ? err.message : "Erro ao pré-visualizar.");
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
        {(["filter", "preview", "distribute"] as Step[]).map((s, index) => (
          <span
            key={s}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              step === s ? "bg-primary/15 text-primary" : "bg-surface-card text-content-muted",
            )}
          >
            {index + 1}. {s === "filter" ? "Filtrar" : s === "preview" ? "Preview" : "Distribuir"}
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
          <div>
            <p className="text-sm font-medium text-content">Etapas do CRM</p>
            <p className="text-xs text-content-muted">Deixe vazio para incluir todas as etapas.</p>
            <div className="mt-2 flex flex-wrap gap-2">
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
          </div>

          <div>
            <label className="text-sm font-medium text-content" htmlFor="offer-inactivity">
              Tempo sem contato
            </label>
            <Select
              id="offer-inactivity"
              className="mt-1"
              value={inactivityDays}
              onChange={(e) => setInactivityDays(e.target.value)}
            >
              {INACTIVITY_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <p className="text-sm font-medium text-content">Responsável atual</p>
            <div className="mt-2 flex flex-wrap gap-2">
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
            <label className="mt-2 flex items-center gap-2 text-sm text-content-muted">
              <input
                type="checkbox"
                checked={includeUnassigned}
                onChange={(e) => setIncludeUnassigned(e.target.checked)}
              />
              Incluir leads sem responsável
            </label>
          </div>

          <Button type="button" disabled={busy} onClick={() => void runPreview()}>
            {busy ? "Calculando..." : "Ver preview da lista"}
          </Button>
        </div>
      ) : null}

      {step === "preview" && preview ? (
        <div className="space-y-4">
          <p className="text-sm text-content">
            <span className="font-semibold text-primary">{preview.matchCount.toLocaleString("pt-BR")}</span> leads
            encontrados
            {preview.cappedCount < preview.matchCount
              ? ` (serão incluídos até ${preview.cappedCount.toLocaleString("pt-BR")} na lista)`
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
              Continuar para distribuição
            </Button>
          </div>
        </div>
      ) : null}

      {step === "distribute" ? (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-content" htmlFor="offer-title">
              Título da lista
            </label>
            <Input id="offer-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <p className="text-sm font-medium text-content">Vendedores</p>
            <label className="mt-2 flex items-center gap-2 text-sm text-content-muted">
              <input type="radio" checked={assignAllSellers} onChange={() => setAssignAllSellers(true)} />
              Todos os vendedores da equipe
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm text-content-muted">
              <input type="radio" checked={!assignAllSellers} onChange={() => setAssignAllSellers(false)} />
              Apenas vendedores selecionados
            </label>
            {!assignAllSellers ? (
              <div className="mt-2 flex flex-wrap gap-2">
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
          </div>

          <div>
            <label className="text-sm font-medium text-content" htmlFor="offer-distribution">
              Modo de distribuição
            </label>
            <Select
              id="offer-distribution"
              className="mt-1"
              value={distributionMode}
              onChange={(e) => setDistributionMode(e.target.value as ActiveOfferDistributionMode)}
            >
              <option value="shared_pool">Fila compartilhada (qualquer vendedor pega o próximo)</option>
              <option value="split_evenly">Dividir leads igualmente entre vendedores</option>
            </Select>
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
