"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { GripVertical, MoreVertical, Plus } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { NewLeadRuleWizard } from "./NewLeadRuleWizard";
import type { ClientSession } from "@/lib/client-auth";
import type { Agent } from "@/lib/types";
import { distributionLabel, sourceLabel, type LeadDistributionRule } from "@/lib/lead-distribution-rules";
import { cn } from "@/lib/utils";
import { MAX_ORG_DIRECTORS, MAX_ORG_MANAGERS, MAX_ORG_SELLERS, MAX_TEAM_EMPLOYEES } from "@/lib/team-employees-types";

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
          : "border-line/80 bg-surface-card/80 ring-1 ring-white/[0.03] backdrop-blur-sm",
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LeadDistributionRule | null>(null);
  const [ruleMenuOpenId, setRuleMenuOpenId] = useState<string | null>(null);
  const menuCloseSkipRef = useRef(false);
  const [draggingRuleId, setDraggingRuleId] = useState<string | null>(null);
  const [dragOverRuleId, setDragOverRuleId] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    const res = await fetch("/api/client/lead-rules", { credentials: "same-origin" });
    if (!res.ok) throw new Error("Unable to load lead rules");
    const data = (await res.json()) as { rules?: LeadDistributionRule[] };
    setRules(data.rules || []);
  }, []);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/client/lead-rules/agents", { credentials: "same-origin" });
    if (!res.ok) throw new Error("Unable to load agents");
    const data = (await res.json()) as { agents?: Agent[] };
    setAgents(data.agents || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchRules(), fetchAgents()]);
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
      if (!res.ok) void fetchRules();
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
      if (!res.ok) return;
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
      if (!res.ok) return;
      await fetchRules();
    },
    [fetchRules],
  );

  const onRuleDeleted = useCallback(
    async (ruleId: string) => {
      const res = await fetch(`/api/client/lead-rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) return;
      setRuleMenuOpenId(null);
      await fetchRules();
    },
    [fetchRules],
  );

  const sorted = useMemo(() => [...rules].sort((a, b) => a.order - b.order), [rules]);

  return (
    <>
      <LeadDistPanel
        title="Controlo de parâmetros"
        description="O fluxo desejado: o lead cadastra no formulário Meta ou fala no WhatsApp; a integração recebe o evento em tempo real; estas regras dizem a que agente enviar o contacto."
        className="overflow-hidden"
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

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="gradient" onClick={openCreateWizard} className="gap-2">
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
          As regras ordenam-se por prioridade — <strong className="font-medium text-content-secondary">arraste um cartão</strong> para a posição desejada. O
          motor associa a entrada ao agente certo antes da conversa abrir.
        </p>

        <ul className="mt-6 space-y-3">
          {sorted.map((rule, idx) => (
            <li
              key={rule.id}
              draggable
              aria-grabbed={draggingRuleId === rule.id}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", rule.id);
                e.dataTransfer.effectAllowed = "move";
                setDraggingRuleId(rule.id);
              }}
              onDragEnd={() => {
                setDraggingRuleId(null);
                setDragOverRuleId(null);
              }}
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
                "cursor-grab active:cursor-grabbing",
                dragOverRuleId === rule.id && draggingRuleId !== rule.id
                  ? "border-primary/50 bg-primary/[0.04] ring-2 ring-primary/25"
                  : "border-line",
                draggingRuleId === rule.id ? "opacity-60" : "",
              )}
            >
              <div className="flex items-start gap-2 sm:items-center">
                <span className="mt-1 shrink-0 text-content-faint" title="Arraste o cartão para mudar a prioridade" aria-hidden>
                  <GripVertical className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="mt-0.5 min-w-[1.5rem] text-xs font-semibold tabular-nums text-content-faint">{idx + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-content">{rule.name}</p>
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
              <div className="relative flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                <div className="text-right text-xs text-content-muted">
                  <p className="max-w-[10rem] truncate font-medium text-content-secondary">{rule.createdBy}</p>
                  <p className="tabular-nums text-content-faint">{rule.createdAtLabel}</p>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    draggable={false}
                    className={cn(
                      "rounded-lg border p-2 text-content-muted transition hover:bg-surface-deep/40",
                      ruleMenuOpenId === rule.id ? "border-primary/40 bg-primary/10" : "border-transparent hover:border-line",
                    )}
                    aria-label={`Mais opções — ${rule.name}`}
                    aria-expanded={ruleMenuOpenId === rule.id}
                    aria-haspopup="menu"
                    onMouseDown={() => {
                      menuCloseSkipRef.current = true;
                    }}
                    onClick={() => setRuleMenuOpenId((id) => (id === rule.id ? null : rule.id))}
                  >
                    <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  {ruleMenuOpenId === rule.id ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[11rem] rounded-xl border border-line bg-surface-card py-1"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full px-3 py-2.5 text-left text-sm text-content hover:bg-surface-deep/50"
                        onClick={() => {
                          setRuleMenuOpenId(null);
                          setEditingRule(rule);
                        }}
                      >
                        Editar regra...
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full px-3 py-2.5 text-left text-sm text-rose-500 hover:bg-rose-500/10"
                        onClick={() => void onRuleDeleted(rule.id)}
                      >
                        Apagar regra
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
