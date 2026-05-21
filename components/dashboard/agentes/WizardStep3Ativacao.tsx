"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { Toggle } from "@/components/ui/Toggle";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Badge } from "@/components/ui/Badge";
import type { AgentOrigin } from "@/lib/types";
import { getWizardOrigin, normalizeOrigensForWizard, type AgentWizardDraft } from "@/lib/agents";
import {
  sourceLabel,
  type LeadDistributionRule,
  type LeadDistributionType,
} from "@/lib/lead-distribution-rules";
import { cn } from "@/lib/utils";

function updateOrigin(draft: AgentWizardDraft, type: AgentOrigin["tipo"], patch: Partial<AgentOrigin>) {
  return normalizeOrigensForWizard(draft.origens).map((origin) =>
    origin.tipo === type ? ({ ...origin, ...patch } as AgentOrigin) : origin,
  );
}

const AGENT_DISTRIBUTION_TYPES: LeadDistributionType[] = [
  "specific_agents",
  "automation_agent",
  "round_robin",
  "all_agents",
];

function ruleLinksAgent(rule: LeadDistributionRule, agentId: string): boolean {
  return rule.agentIds.includes(agentId);
}

function buildRulePayloadForLink(
  rule: LeadDistributionRule,
  agentId: string,
  linked: boolean,
): LeadDistributionRule {
  const hasAgentDistribution = AGENT_DISTRIBUTION_TYPES.includes(rule.distributionType);
  let distributionType = rule.distributionType;
  if (!hasAgentDistribution) {
    distributionType = "automation_agent";
  }

  let agentIds = rule.agentIds;
  if (linked) {
    if (distributionType === "automation_agent") {
      agentIds = [agentId];
    } else if (!agentIds.includes(agentId)) {
      agentIds = [...agentIds, agentId];
    }
  } else {
    agentIds = agentIds.filter((id) => id !== agentId);
  }

  return { ...rule, distributionType, agentIds };
}

function LeadRulesSelector({
  agentId,
  onLinkedChange,
}: {
  agentId: string | null;
  onLinkedChange: (hasLinked: boolean) => void;
}) {
  const [availableRules, setAvailableRules] = useState<LeadDistributionRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);

  const activeRules = useMemo(
    () => availableRules.filter((r) => r.active !== false).sort((a, b) => a.order - b.order),
    [availableRules],
  );

  const linkedCount = useMemo(
    () => (agentId ? activeRules.filter((r) => ruleLinksAgent(r, agentId)).length : 0),
    [activeRules, agentId],
  );

  useEffect(() => {
    onLinkedChange(linkedCount > 0);
  }, [linkedCount, onLinkedChange]);

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetch("/api/client/lead-rules", { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Não foi possível carregar as regras.");
      }
      const data = (await res.json()) as { rules?: LeadDistributionRule[] };
      setAvailableRules(data.rules ?? []);
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : "Erro ao carregar regras.");
      setAvailableRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const toggleRule = async (rule: LeadDistributionRule) => {
    if (!agentId) return;
    const linked = ruleLinksAgent(rule, agentId);
    const nextRule = buildRulePayloadForLink(rule, agentId, !linked);

    setTogglingRuleId(rule.id);
    setRulesError(null);
    try {
      const res = await fetch(`/api/client/lead-rules/${encodeURIComponent(rule.id)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextRule),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Não foi possível atualizar a regra.");
      }
      const data = (await res.json()) as { rule?: LeadDistributionRule };
      if (data.rule) {
        setAvailableRules((prev) => prev.map((r) => (r.id === data.rule!.id ? data.rule! : r)));
      } else {
        await fetchRules();
      }
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : "Erro ao atualizar a regra.");
    } finally {
      setTogglingRuleId(null);
    }
  };

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
      <div>
        <p className="text-sm font-semibold text-content">Regras de distribuição de leads</p>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Selecione as regras do Integrações de Leads que este agente vai monitorar. Quando um novo lead chegar por essas
          regras, este agente entra em contato automaticamente.
        </p>
      </div>

      {!agentId ? (
        <p className="text-xs font-medium text-amber-600 dark:text-amber-300/90">
          Guarde o agente e abra novamente em modo edição para vincular regras de distribuição.
        </p>
      ) : null}

      {rulesLoading ? (
        <p className="text-xs text-content-muted">Buscando regras...</p>
      ) : rulesError ? (
        <p className="text-xs font-medium text-orange-600 dark:text-orange-400">{rulesError}</p>
      ) : activeRules.length === 0 ? (
        <p className="text-xs leading-relaxed text-content-muted">
          Nenhuma regra configurada. Crie regras em{" "}
          <Link href="/dashboard/integracoes-leads" className="font-semibold text-primary underline-offset-2 hover:underline">
            Integrações de Leads
          </Link>
          .
        </p>
      ) : (
        <ul className="max-h-60 space-y-2 overflow-y-auto overscroll-contain" role="listbox" aria-label="Regras de distribuição">
          {activeRules.map((rule) => {
            const linked = Boolean(agentId && ruleLinksAgent(rule, agentId));
            const busy = togglingRuleId === rule.id;
            const originLabel = sourceLabel(rule.source);
            const subtitle =
              rule.source === "meta_form" && rule.pageLabel?.trim()
                ? `${rule.name} · ${rule.pageLabel}`
                : rule.name;

            return (
              <li key={rule.id} className="list-none">
                <button
                  type="button"
                  role="option"
                  aria-selected={linked}
                  disabled={!agentId || busy}
                  onClick={() => void toggleRule(rule)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition sm:px-4",
                    linked
                      ? "border-[#f24400]/35 bg-[rgba(242,68,0,0.08)] ring-1 ring-inset ring-[#f24400]/30"
                      : "border-line/80 bg-surface-deep/30 hover:bg-surface-elevated/40",
                    (!agentId || busy) && "cursor-not-allowed opacity-60",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-content">{subtitle}</span>
                    <span className="mt-1 inline-flex flex-wrap items-center gap-2">
                      <Badge className="border-line/80 bg-surface-card text-[10px] font-medium text-content-secondary">
                        {originLabel}
                      </Badge>
                      {busy ? <span className="text-[10px] text-content-muted">A guardar…</span> : null}
                    </span>
                  </span>
                  {linked ? (
                    <Check className="h-5 w-5 shrink-0 text-[#f24400]" strokeWidth={2.5} aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function WizardStep3Ativacao({
  draft,
  onChange,
  agentId: agentIdProp,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  /** ID do agente em edição (página ou overlay). */
  agentId?: string;
}) {
  const pathname = usePathname();
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);

  const agentIdFromPath = useMemo(() => {
    const match = pathname?.match(/\/dashboard\/agentes\/([^/]+)\/editar/);
    return match?.[1]?.trim() || null;
  }, [pathname]);

  const agentId = agentIdProp?.trim() || agentIdFromPath || resolvedAgentId;

  useEffect(() => {
    if (agentIdProp?.trim() || agentIdFromPath || !draft.nome.trim()) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client/agentes", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = (await res.json()) as { agents?: { id: string; nome?: string }[] };
        const matches = (data.agents ?? []).filter((a) => (a.nome ?? "").trim() === draft.nome.trim());
        if (!cancelled && matches.length === 1) {
          setResolvedAgentId(matches[0]!.id);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentIdFromPath, agentIdProp, draft.nome]);

  const leadAds = getWizardOrigin(draft, "lead_ads");
  const ctw = getWizardOrigin(draft, "ctw");

  const handleLinkedChange = useCallback(
    (hasLinked: boolean) => {
      if (leadAds.ativo === hasLinked) return;
      onChange({ ...draft, origens: updateOrigin(draft, "lead_ads", { ativo: hasLinked }) });
    },
    [draft, leadAds.ativo, onChange],
  );

  return (
    <div className="min-w-0 space-y-4">
      <h3 className="text-base font-semibold text-content">Quando este agente deve ser acionado?</h3>

      <LeadRulesSelector agentId={agentId} onLinkedChange={handleLinkedChange} />

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
