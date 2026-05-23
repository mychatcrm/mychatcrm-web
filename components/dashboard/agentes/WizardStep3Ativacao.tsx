"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, FileText, Search } from "lucide-react";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import type { MetaFormsForm } from "@/app/api/client/meta/forms/route";
import type { MetaStatusPage } from "@/app/api/client/meta/status/route";
import type { AgentOrigin } from "@/lib/types";
import { getWizardOrigin, normalizeOrigensForWizard, type AgentWizardDraft } from "@/lib/agents";
import { ORGANIC_WHATSAPP_SOURCE, type LeadDistributionRule } from "@/lib/lead-distribution-rules";
import { cn } from "@/lib/utils";

function updateOrigin(draft: AgentWizardDraft, type: AgentOrigin["tipo"], patch: Partial<AgentOrigin>) {
  return normalizeOrigensForWizard(draft.origens).map((origin) =>
    origin.tipo === type ? ({ ...origin, ...patch } as AgentOrigin) : origin,
  );
}

function setExclusiveActivationMode(
  draft: AgentWizardDraft,
  mode: "formulario" | "organico" | null,
): AgentWizardDraft {
  const origens = normalizeOrigensForWizard(draft.origens).map((origin) => {
    if (origin.tipo === "lead_ads") return { ...origin, ativo: mode === "formulario" };
    if (origin.tipo === "organico") return { ...origin, ativo: mode === "organico" };
    if (origin.tipo === "ctw") return { ...origin, ativo: false };
    return origin;
  });
  return { ...draft, origens };
}

function normalizeFormSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function getFormsUsedByOtherAgents(rules: LeadDistributionRule[], agentId: string): Set<string> {
  const blocked = new Set<string>();
  for (const rule of rules) {
    if (rule.source !== "meta_form") continue;
    const hasOtherAgent = rule.agentIds.some((id) => id !== agentId);
    if (!hasOtherAgent) continue;
    for (const formId of rule.includedFormIds ?? []) {
      blocked.add(formId);
    }
  }
  return blocked;
}

function getFormsLinkedToAgent(rules: LeadDistributionRule[], agentId: string): Set<string> {
  const linked = new Set<string>();
  for (const rule of rules) {
    if (rule.source !== "meta_form") continue;
    if (!rule.agentIds.includes(agentId)) continue;
    for (const formId of rule.includedFormIds ?? []) {
      linked.add(formId);
    }
  }
  return linked;
}

function findRuleForAgentForm(
  rules: LeadDistributionRule[],
  agentId: string,
  formId: string,
): LeadDistributionRule | undefined {
  return rules.find(
    (r) =>
      r.source === "meta_form" &&
      r.agentIds.includes(agentId) &&
      (r.includedFormIds ?? []).includes(formId),
  );
}

function MetaFormsSelector({
  agentId,
  draft,
  onChange,
}: {
  agentId: string | null;
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const leadAds = getWizardOrigin(draft, "lead_ads");

  const [pages, setPages] = useState<MetaStatusPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pageId, setPageId] = useState("");

  const [availableForms, setAvailableForms] = useState<MetaFormsForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);

  const [leadRules, setLeadRules] = useState<LeadDistributionRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);

  const [formSearch, setFormSearch] = useState("");
  const [togglingFormId, setTogglingFormId] = useState<string | null>(null);
  const [formsActionError, setFormsActionError] = useState<string | null>(null);

  const selectedFormIds = useMemo(() => getFormsLinkedToAgent(leadRules, agentId ?? ""), [leadRules, agentId]);

  const blockedFormIds = useMemo(
    () => (agentId ? getFormsUsedByOtherAgents(leadRules, agentId) : new Set<string>()),
    [agentId, leadRules],
  );

  const fetchLeadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await fetch("/api/client/lead-rules", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Não foi possível carregar regras.");
      const data = (await res.json()) as { rules?: LeadDistributionRule[] };
      setLeadRules(data.rules ?? []);
    } catch {
      setLeadRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLeadRules();
  }, [fetchLeadRules]);

  useEffect(() => {
    let cancelled = false;
    setPagesLoading(true);
    setPagesError(null);
    fetch("/api/client/meta/status", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Não foi possível carregar páginas Meta.");
        }
        return res.json() as Promise<{ connected?: boolean; pages?: MetaStatusPage[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        const list = data.pages ?? [];
        setPages(list);
        setPageId((current) => {
          if (list.length === 1) return list[0]!.page_id;
          if (current && list.some((p) => p.page_id === current)) return current;
          return list[0]?.page_id ?? "";
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setPagesError(err instanceof Error ? err.message : "Erro ao carregar Meta.");
          setPages([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pageId.trim()) {
      setAvailableForms([]);
      setFormsError(null);
      return;
    }

    let cancelled = false;
    setFormsLoading(true);
    setFormsError(null);
    fetch(`/api/client/meta/forms?page_id=${encodeURIComponent(pageId)}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Não foi possível carregar formulários.");
        }
        return res.json() as Promise<{ forms?: MetaFormsForm[] }>;
      })
      .then((data) => {
        if (!cancelled) setAvailableForms(data.forms ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setFormsError(err instanceof Error ? err.message : "Erro ao carregar formulários.");
          setAvailableForms([]);
        }
      })
      .finally(() => {
        if (!cancelled) setFormsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const selectedPage = pages.find((p) => p.page_id === pageId);

  const updateDraftFormIdsFromRules = (rules: LeadDistributionRule[]) => {
    if (!agentId) return;
    const ids = [...getFormsLinkedToAgent(rules, agentId)];
    onChange({
      ...draft,
      origens: updateOrigin(draft, "lead_ads", {
        config: { ...leadAds.config, formIds: ids },
      }),
    });
  };

  const toggleForm = async (form: MetaFormsForm) => {
    if (!agentId || !pageId) return;
    const formId = form.form_id;
    if (blockedFormIds.has(formId)) return;

    const selected = selectedFormIds.has(formId);
    setTogglingFormId(formId);
    setFormsActionError(null);

    try {
      if (selected) {
        const rule = findRuleForAgentForm(leadRules, agentId, formId);
        if (!rule) {
          await fetchLeadRules();
          return;
        }
        const nextRule: LeadDistributionRule = {
          ...rule,
          agentIds: rule.agentIds.filter((id) => id !== agentId),
        };
        const res = await fetch(`/api/client/lead-rules/${encodeURIComponent(rule.id)}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextRule),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Não foi possível actualizar a regra.");
        }
        const data = (await res.json()) as { rule?: LeadDistributionRule; deleted?: boolean };
        const nextRules = data.deleted
          ? leadRules.filter((r) => r.id !== rule.id)
          : data.rule
            ? leadRules.map((r) => (r.id === data.rule!.id ? data.rule! : r))
            : leadRules;
        setLeadRules(nextRules);
        updateDraftFormIdsFromRules(nextRules);
        if (data.deleted) {
          await fetch(`/api/client/meta/form-mapping?form_id=${encodeURIComponent(formId)}`, {
            method: "DELETE",
            credentials: "same-origin",
          }).catch(() => undefined);
        }
      } else {
        const existing = findRuleForAgentForm(leadRules, agentId, formId);
        if (existing) {
          updateDraftFormIdsFromRules(leadRules);
          return;
        }

        const formName = form.form_name?.trim() || formId;
        const res = await fetch("/api/client/lead-rules", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `Formulário · ${formName}`,
            source: "meta_form",
            distributionType: "automation_agent",
            agentIds: [agentId],
            includedFormIds: [formId],
            useAllForms: false,
            pageId,
            pageLabel: selectedPage?.page_name ?? pageId,
            redistribution: false,
            mappings: [],
            employeeIds: [],
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Não foi possível criar a regra do formulário.");
        }
        const data = (await res.json()) as { rule?: LeadDistributionRule };
        const nextRules = data.rule ? [...leadRules, data.rule] : leadRules;
        setLeadRules(nextRules);
        updateDraftFormIdsFromRules(nextRules);
      }
    } catch (err) {
      setFormsActionError(err instanceof Error ? err.message : "Erro ao guardar formulário.");
    } finally {
      setTogglingFormId(null);
    }
  };

  const filteredForms = useMemo(() => {
    const query = normalizeFormSearchText(formSearch.trim());
    return availableForms.filter((f) => {
      if (!query) return true;
      const label = normalizeFormSearchText(f.form_name ?? f.form_id);
      return label.includes(query);
    });
  }, [availableForms, formSearch]);

  if (!agentId) {
    return (
      <section className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
        <p className="text-xs font-medium text-amber-600 dark:text-amber-300/90">
          Guarde o agente e abra novamente em modo edição para vincular formulários Meta.
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
      <div>
        <p className="text-sm font-semibold text-content">Formulários Meta (Lead Ads)</p>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Escolha os formulários desta página. Cada formulário seleccionado cria automaticamente uma regra em Integrações de
          Leads.
        </p>
      </div>

      {pagesLoading || rulesLoading ? (
        <p className="text-xs text-content-muted">A carregar páginas Meta…</p>
      ) : pagesError ? (
        <p className="text-xs font-medium text-orange-600 dark:text-orange-400">{pagesError}</p>
      ) : !pages.length ? (
        <p className="text-xs leading-relaxed text-content-muted">
          Nenhuma página Meta conectada. Configure em{" "}
          <Link href="/dashboard/integracoes" className="font-semibold text-primary underline-offset-2 hover:underline">
            Integrações
          </Link>
          .
        </p>
      ) : (
        <>
          {pages.length > 1 ? (
            <div>
              <label className="text-[11px] font-semibold text-content-muted" htmlFor="agent-meta-page-select">
                Página do Facebook
              </label>
              <Select
                id="agent-meta-page-select"
                className="mt-1.5 min-h-[44px] rounded-xl"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
              >
                {pages.map((p) => (
                  <option key={p.page_id} value={p.page_id}>
                    {p.page_name ?? p.page_id}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <p className="text-xs text-content-secondary">
              Página: <span className="font-medium text-content">{selectedPage?.page_name ?? pageId}</span>
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-line/80 bg-surface-deep/60">
            <div className="border-b border-line/70 p-2 sm:p-2.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
                  strokeWidth={2}
                  aria-hidden
                />
                <Input
                  type="search"
                  autoComplete="off"
                  placeholder="Buscar formulário..."
                  value={formSearch}
                  disabled={formsLoading || !!formsError}
                  onChange={(e) => setFormSearch(e.target.value)}
                  className="h-11 rounded-xl border-line bg-surface-card pl-9 text-sm"
                />
              </div>
            </div>
            <ul
              className="max-h-60 overflow-y-auto overscroll-contain"
              role="listbox"
              aria-multiselectable="true"
              aria-label="Formulários Meta"
            >
              {formsLoading ? (
                <li className="px-3 py-3.5 text-xs text-content-muted">Buscando formulários...</li>
              ) : formsError ? (
                <li className="px-3 py-3.5 text-xs font-medium text-orange-600 dark:text-orange-400">{formsError}</li>
              ) : !availableForms.length ? (
                <li className="px-3 py-3.5 text-xs text-content-muted">Nenhum formulário activo nesta página</li>
              ) : !filteredForms.length ? (
                <li className="px-3 py-3.5 text-xs text-content-muted">Nenhum formulário encontrado para essa busca</li>
              ) : (
                filteredForms.map((f, i) => {
                  const selected = selectedFormIds.has(f.form_id);
                  const blocked = blockedFormIds.has(f.form_id);
                  const busy = togglingFormId === f.form_id;

                  return (
                    <li key={f.form_id} className="list-none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={blocked || busy}
                        onClick={() => void toggleForm(f)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-3 text-left transition sm:gap-3.5 sm:px-4 sm:py-3.5",
                          i > 0 && "border-t border-line/70",
                          blocked
                            ? "cursor-not-allowed bg-red-500/[0.06] text-red-800 dark:text-red-200"
                            : selected
                              ? "bg-[rgba(242,68,0,0.08)] ring-1 ring-inset ring-[#f24400]/30"
                              : "hover:bg-surface-card/70",
                          busy && "opacity-60",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-content">{f.form_name ?? f.form_id}</span>
                          {f.form_name && f.form_name !== f.form_id ? (
                            <span className="mt-0.5 block truncate text-[11px] text-content-muted">{f.form_id}</span>
                          ) : null}
                          {blocked ? (
                            <span className="mt-1 block text-[11px] font-semibold text-red-600 dark:text-red-400">
                              Em uso por outro agente
                            </span>
                          ) : null}
                          {busy ? <span className="mt-1 block text-[10px] text-content-muted">A guardar…</span> : null}
                        </span>
                        {selected && !blocked ? (
                          <Check className="h-5 w-5 shrink-0 text-[#f24400]" strokeWidth={2.5} aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}

      {formsActionError ? (
        <p className="text-xs font-medium text-orange-600 dark:text-orange-400">{formsActionError}</p>
      ) : null}
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
  agentId?: string;
}) {
  const pathname = usePathname();
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);
  const [checkingOrganic, setCheckingOrganic] = useState(false);
  const [organicBlocked, setOrganicBlocked] = useState(false);
  const [organicBlockedBy, setOrganicBlockedBy] = useState<string | null>(null);
  const [organicSaving, setOrganicSaving] = useState(false);
  const [organicError, setOrganicError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!agentId) {
      setOrganicBlocked(false);
      setOrganicBlockedBy(null);
      setCheckingOrganic(false);
      return;
    }

    let cancelled = false;
    setCheckingOrganic(true);
    fetch("/api/client/lead-rules", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data: { rules?: LeadDistributionRule[] }) => {
        if (cancelled) return;
        const organicRule = data.rules?.find(
          (r) =>
            r.source === ORGANIC_WHATSAPP_SOURCE &&
            r.agentIds.length > 0 &&
            !r.agentIds.includes(agentId),
        );
        if (organicRule) {
          setOrganicBlocked(true);
          setOrganicBlockedBy(organicRule.name);
        } else {
          setOrganicBlocked(false);
          setOrganicBlockedBy(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOrganicBlocked(false);
          setOrganicBlockedBy(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingOrganic(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const leadAds = getWizardOrigin(draft, "lead_ads");
  const organico = getWizardOrigin(draft, "organico");

  const activeMode: "formulario" | "organico" | null = leadAds.ativo
    ? "formulario"
    : organico.ativo
      ? "organico"
      : null;

  const selectFormulario = () => {
    setOrganicError(null);
    onChange(setExclusiveActivationMode(draft, "formulario"));
  };

  const ensureOrganicRule = async (id: string): Promise<boolean> => {
    const res = await fetch("/api/client/lead-rules", { credentials: "same-origin" });
    if (!res.ok) return false;
    const data = (await res.json()) as { rules?: LeadDistributionRule[] };
    const ownRule = data.rules?.find(
      (r) => r.source === ORGANIC_WHATSAPP_SOURCE && r.agentIds.includes(id),
    );
    if (ownRule) return true;

    const postRes = await fetch("/api/client/lead-rules", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "WhatsApp direto",
        source: ORGANIC_WHATSAPP_SOURCE,
        distributionType: "automation_agent",
        agentIds: [id],
        redistribution: false,
        mappings: [],
        employeeIds: [],
      }),
    });
    if (!postRes.ok) {
      const body = (await postRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Não foi possível criar a regra de WhatsApp direto.");
    }
    return true;
  };

  const selectOrganico = async () => {
    if (organicBlocked || checkingOrganic || !agentId) return;
    setOrganicError(null);
    onChange(setExclusiveActivationMode(draft, "organico"));
    setOrganicSaving(true);
    try {
      await ensureOrganicRule(agentId);
    } catch (err) {
      setOrganicError(err instanceof Error ? err.message : "Erro ao configurar WhatsApp direto.");
      onChange(setExclusiveActivationMode(draft, null));
    } finally {
      setOrganicSaving(false);
    }
  };

  const cardSelectedClass = "border-[#f24400] bg-[rgba(242,68,0,0.05)] ring-1 ring-inset ring-[#f24400]/30";
  const cardNeutralClass = "border-line/80 bg-surface-card hover:border-primary/30 hover:bg-surface-deep/40";

  return (
    <div className="min-w-0 space-y-4">
      <h3 className="text-base font-semibold text-content">Quando este agente deve ser acionado?</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={selectFormulario}
          className={cn(
            "flex min-h-[120px] flex-col items-start gap-3 rounded-xl border p-4 text-left transition",
            activeMode === "formulario" ? cardSelectedClass : cardNeutralClass,
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold text-content">Leads por formulário</span>
            <span className="mt-1 block text-xs leading-relaxed text-content-muted">
              O agente atende leads que chegam por formulários vinculados em Integrações de Leads.
            </span>
          </span>
        </button>

        <button
          type="button"
          disabled={organicBlocked || checkingOrganic || organicSaving || !agentId}
          onClick={() => void selectOrganico()}
          className={cn(
            "flex min-h-[120px] flex-col items-start gap-3 rounded-xl border p-4 text-left transition",
            organicBlocked
              ? "cursor-not-allowed border-line/60 bg-surface-deep/50 opacity-80"
              : activeMode === "organico"
                ? cardSelectedClass
                : cardNeutralClass,
            (checkingOrganic || organicSaving) && "cursor-wait opacity-70",
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl",
              organicBlocked ? "bg-surface-deep text-content-muted" : "bg-emerald-500/15 text-emerald-600",
            )}
          >
            <WhatsAppGlyph className="h-6 w-6 shrink-0" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold text-content">Atendimento direto (WhatsApp)</span>
            <span className="mt-1 block text-xs leading-relaxed text-content-muted">
              O agente atende quem entra em contacto directo pelo WhatsApp, sem ser por formulário.
            </span>
            {organicBlocked && organicBlockedBy ? (
              <span className="mt-2 block text-xs font-semibold text-red-600 dark:text-red-400">
                Já em uso por: {organicBlockedBy}
              </span>
            ) : null}
            {organicSaving ? (
              <span className="mt-2 block text-xs text-content-muted">A configurar regra orgânica…</span>
            ) : null}
            {organicError ? (
              <span className="mt-2 block text-xs font-medium text-orange-600 dark:text-orange-400">{organicError}</span>
            ) : null}
            {!agentId ? (
              <span className="mt-2 block text-xs font-medium text-amber-600 dark:text-amber-300/90">
                Guarde o agente para activar WhatsApp directo.
              </span>
            ) : null}
          </span>
        </button>
      </div>

      {activeMode === "formulario" ? (
        <MetaFormsSelector agentId={agentId} draft={draft} onChange={onChange} />
      ) : null}
    </div>
  );
}
