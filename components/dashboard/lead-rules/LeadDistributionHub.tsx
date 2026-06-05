"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { GripVertical, MoreVertical, Plus, X } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { NewLeadRuleWizard } from "./NewLeadRuleWizard";
import type { ClientSession } from "@/lib/client-auth";
import type { Agent } from "@/lib/types";
import { distributionLabel, sourceLabel, type LeadDistributionRule } from "@/lib/lead-distribution-rules";
import { cn } from "@/lib/utils";
import { MAX_ORG_DIRECTORS, MAX_ORG_MANAGERS, MAX_ORG_SELLERS, MAX_TEAM_EMPLOYEES } from "@/lib/team-employees-types";

async function readApiError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return typeof data.error === "string" && data.error.trim() ? data.error : fallback;
}

function LeadDistPanel({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  const { isLight } = usePanelAppearance();
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border p-5 sm:p-6 transition-colors",
        isLight
          ? "border-slate-200/80 bg-surface-deep text-content"
          : "border-line/80 bg-surface-card text-content",
        className,
      )}
    >
      <div className="mb-5">
        <h2 className="font-display text-[17px] font-bold leading-tight tracking-tight text-content sm:text-lg">{title}</h2>
        {description ? (
          <p className={cn("mt-1.5 text-[13px] leading-relaxed", isLight ? "text-slate-600" : "text-content-muted")}>
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function LeadDistributionHub({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();
  const tenantId = session.tenantId;
  const [rules, setRules] = useState<LeadDistributionRule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LeadDistributionRule | null>(null);
  const [ruleMenuOpenId, setRuleMenuOpenId] = useState<string | null>(null);
  const menuCloseSkipRef = useRef(false);
  const [draggingRuleId, setDraggingRuleId] = useState<string | null>(null);
  const [dragOverRuleId, setDragOverRuleId] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    const res = await fetch("/api/client/lead-rules", { credentials: "same-origin" });
    if (!res.ok) throw new Error(await readApiError(res, "Não foi possível carregar as regras."));
    const data = (await res.json()) as { rules?: LeadDistributionRule[] };
    setRules(data.rules || []);
  }, []);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/client/lead-rules/agents", { credentials: "same-origin" });
    if (!res.ok) throw new Error(await readApiError(res, "Não foi possível carregar os agentes."));
    const data = (await res.json()) as { agents?: Agent[] };
    setAgents(data.agents || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([fetchRules(), fetchAgents()]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [fetchAgents, fetchRules]);

  useEffect(() => {
    void refresh();
  }, [refresh, tenantId]);

  useEffect(() => {
    if (!ruleMenuOpenId) return;
    const onDoc = () => {
      if (menuCloseSkipRef.current) {
        menuCloseSkipRef.current = false;
        return;
      }
      setRuleMenuOpenId(null);
    };
    const t = window.setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", onDoc);
    };
  }, [ruleMenuOpenId]);

  const closeWizard = useCallback(() => {
    setWizardOpen(false);
    setEditingRule(null);
  }, []);

  const openCreateWizard = useCallback(() => {
    setEditingRule(null);
    setActionError(null);
    setWizardOpen(true);
  }, []);

  const reorderRuleByDrag = useCallback(
    async (activeId: string, overId: string) => {
      const current = [...rules].sort((a, b) => a.order - b.order);
      const fromIdx = current.findIndex((r) => r.id === activeId);
      const toIdx = current.findIndex((r) => r.id === overId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

      const next = [...current];
      const [removed] = next.splice(fromIdx, 1);
      if (!removed) return;
      next.splice(toIdx, 0, removed);
      const reordered = next.map((r, i) => ({ ...r, order: i }));
      setRules(reordered);

      const res = await fetch("/api/client/lead-rules/reorder", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: reordered.map((r) => r.id) }),
      });
      if (!res.ok) {
        setActionError(await readApiError(res, "Não foi possível reordenar as regras."));
        void fetchRules();
      }
    },
    [fetchRules, rules],
  );

  const onRuleUpdated = useCallback(
    async (rule: LeadDistributionRule) => {
      const res = await fetch(`/api/client/lead-rules/${encodeURIComponent(rule.id)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (!res.ok) {
        setActionError(await readApiError(res, "Não foi possível atualizar a regra."));
        return;
      }
      setActionError(null);
      await fetchRules();
    },
    [fetchRules],
  );

  const onRuleCreated = useCallback(
    async (rule: LeadDistributionRule) => {
      const res = await fetch("/api/client/lead-rules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (!res.ok) {
        setActionError(await readApiError(res, "Não foi possível criar a regra."));
        return;
      }
      setActionError(null);
      await fetchRules();
    },
    [fetchRules],
  );

  const onRuleDeleted = useCallback(
    async (rule: LeadDistributionRule) => {
      const ok = window.confirm(
        `Apagar a regra «${rule.name}»?\n\nLeads já criados no CRM não serão removidos; apenas a regra de distribuição deixa de existir.`,
      );
      if (!ok) return;

      setDeletingRuleId(rule.id);
      setActionError(null);
      menuCloseSkipRef.current = true;
      try {
        const res = await fetch(`/api/client/lead-rules/${encodeURIComponent(rule.id)}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok) {
          setActionError(await readApiError(res, "Não foi possível apagar a regra."));
          return;
        }
        setRuleMenuOpenId(null);
        await fetchRules();
      } catch {
        setActionError("Erro de rede ao apagar a regra.");
      } finally {
        setDeletingRuleId(null);
      }
    },
    [fetchRules],
  );

  const sorted = useMemo(() => [...rules].sort((a, b) => a.order - b.order), [rules]);

  return (
    <>
      <LeadDistPanel
        title="Controlo de parâmetros"
        description="O fluxo desejado: o lead cadastra no formulário Meta ou fala no WhatsApp; a integração recebe o evento em tempo real; estas regras dizem a que agente enviar o contacto."
      >
        <p className="mb-4 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2.5 text-xs leading-relaxed text-content-secondary">
          <strong className="text-content">Equipa humana:</strong> hierarquia com até{" "}
          <span className="font-semibold text-content">
            {MAX_ORG_DIRECTORS} diretores, {MAX_ORG_MANAGERS} gerentes e {MAX_ORG_SELLERS} vendedores
          </span>{" "}
          ({MAX_TEAM_EMPLOYEES} no total) em{" "}
          <Link href="/dashboard/colaboradores" className="font-semibold text-primary underline-offset-2 hover:underline">
            Colaboradores
          </Link>{" "}
          e use-os nas regras (plantão, fila ou todos). Agentes de IA continuam em «Agentes».
        </p>

        {loadError ? (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {loadError}{" "}
            <button type="button" className="font-medium underline" onClick={() => void refresh()}>
              Tentar novamente
            </button>
          </p>
        ) : null}

        {actionError ? (
          <div className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            <p className="min-w-0 flex-1">{actionError}</p>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
              aria-label="Fechar aviso"
              onClick={() => setActionError(null)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="gradient" onClick={openCreateWizard} className="w-full gap-2 sm:w-auto">
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              Nova regra
            </Button>
            <span className="text-xs text-content-muted">
              <span className="font-semibold tabular-nums text-content">{sorted.length}</span> regras
              {loading ? <span className="ml-2 text-content-faint">carregando...</span> : null}
            </span>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-content-faint">
          As regras ordenam-se por prioridade —{" "}
          <strong className="font-medium text-content-secondary">arraste pelo ícone ⋮⋮</strong> para mudar a posição. O motor
          associa a entrada ao agente certo antes da conversa abrir.
        </p>

        {!loading && sorted.length === 0 && !loadError ? (
          <p className="mt-6 rounded-xl border border-dashed border-line bg-surface-elevated/30 px-4 py-10 text-center text-sm text-content-muted">
            Nenhuma regra configurada. Clique em «Nova regra» para começar.
          </p>
        ) : null}

        <ul className="mt-6 space-y-3">
          {sorted.map((rule, idx) => (
            <li
              key={rule.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (rule.id !== draggingRuleId) setDragOverRuleId(rule.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverRuleId((id) => (id === rule.id ? null : id));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain");
                if (fromId && fromId !== rule.id) void reorderRuleByDrag(fromId, rule.id);
                setDraggingRuleId(null);
                setDragOverRuleId(null);
              }}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-surface-card p-4 transition sm:flex-row sm:items-center sm:gap-4",
                dragOverRuleId === rule.id && draggingRuleId !== rule.id
                  ? "border-primary/50 bg-primary/[0.04] ring-2 ring-primary/25"
                  : "border-line",
                draggingRuleId === rule.id ? "opacity-60" : "",
              )}
            >
              <div className="flex items-start gap-2 sm:items-center">
                <span
                  draggable
                  aria-grabbed={draggingRuleId === rule.id}
                  title="Arraste para mudar a prioridade"
                  className="mt-1 shrink-0 cursor-grab text-content-faint active:cursor-grabbing"
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", rule.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingRuleId(rule.id);
                  }}
                  onDragEnd={() => {
                    setDraggingRuleId(null);
                    setDragOverRuleId(null);
                  }}
                >
                  <GripVertical className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="mt-0.5 min-w-[1.5rem] text-xs font-semibold tabular-nums text-content-faint">{idx + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold text-content">{rule.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge className="border-primary/35 bg-primary/5 text-primary">{sourceLabel(rule.source)}</Badge>
                  <span className="text-content-faint" aria-hidden>
                    →
                  </span>
                  <Badge className={cn("border-emerald-500/40 bg-emerald-500/5", isLight ? "text-emerald-800" : "text-emerald-200")}>
                    {distributionLabel(rule.distributionType)}
                  </Badge>
                  {rule.redistribution ? (
                    <Badge className={cn("border-amber-500/45 bg-amber-500/5", isLight ? "text-amber-800" : "text-amber-200")}>
                      Redistribui
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="relative flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
                <div className="text-left text-xs text-content-muted sm:text-right">
                  <p className="max-w-full truncate font-medium text-content-secondary sm:max-w-[10rem]">{rule.createdBy}</p>
                  <p className="tabular-nums text-content-faint">{rule.createdAtLabel}</p>
                </div>
                <div className="relative self-end">
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg border p-2 text-content-muted transition hover:bg-surface-deep/40",
                      ruleMenuOpenId === rule.id ? "border-primary/40 bg-primary/10" : "border-transparent hover:border-line",
                    )}
                    aria-label={`Mais opções — ${rule.name}`}
                    aria-expanded={ruleMenuOpenId === rule.id}
                    aria-haspopup="menu"
                    disabled={deletingRuleId === rule.id}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      menuCloseSkipRef.current = true;
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRuleMenuOpenId((id) => (id === rule.id ? null : rule.id));
                    }}
                  >
                    <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  {ruleMenuOpenId === rule.id ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[11rem] rounded-xl border border-line bg-surface-card py-1"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        menuCloseSkipRef.current = true;
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full px-3 py-2.5 text-left text-sm text-content hover:bg-surface-deep/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRuleMenuOpenId(null);
                          setEditingRule(rule);
                        }}
                      >
                        Editar regra...
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={deletingRuleId === rule.id}
                        className="flex w-full px-3 py-2.5 text-left text-sm text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRuleDeleted(rule);
                        }}
                      >
                        {deletingRuleId === rule.id ? "Apagando…" : "Apagar regra"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </LeadDistPanel>

      <NewLeadRuleWizard
        open={wizardOpen || editingRule !== null}
        onClose={closeWizard}
        agents={agents}
        displayName={session.displayName}
        tenantId={tenantId}
        initialRule={editingRule}
        onCreated={onRuleCreated}
        onUpdated={onRuleUpdated}
      />
    </>
  );
}
