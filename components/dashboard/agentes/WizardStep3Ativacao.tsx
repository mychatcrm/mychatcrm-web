"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText, MessageCircleQuestion } from "lucide-react";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import type { MetaFormsForm } from "@/app/api/client/meta/forms/route";
import type { AgentWizardDraft } from "@/lib/agents";
import { ORGANIC_WHATSAPP_SOURCE, type LeadDistributionRule } from "@/lib/lead-distribution-rules";
import { cn } from "@/lib/utils";

function getFormRulesForAgent(rules: LeadDistributionRule[], agentId: string): LeadDistributionRule[] {
  return rules.filter((r) => r.source === "meta_form" && r.agentIds.includes(agentId));
}

function getOrganicRulesForAgent(rules: LeadDistributionRule[], agentId: string): LeadDistributionRule[] {
  return rules.filter((r) => r.source === ORGANIC_WHATSAPP_SOURCE && r.agentIds.includes(agentId));
}

function RuleStatusBadge({ active }: { active?: boolean }) {
  if (active === false) {
    return (
      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
        Regra inativa
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
      Ativa
    </span>
  );
}

/** Um formulário confirmado ativo na Meta, dentro de uma regra específica. */
function FormRuleCard({
  rule,
  formNames,
  formNamesLoading,
  pageFailed,
}: {
  rule: LeadDistributionRule;
  formNames: Record<string, string>;
  formNamesLoading: boolean;
  pageFailed: boolean;
}) {
  const formIds = rule.includedFormIds ?? [];
  const activeFormIds = pageFailed ? formIds : formIds.filter((id) => Boolean(formNames[id]));
  const archivedCount = formIds.length - activeFormIds.length;

  return (
    <div className="min-w-0 space-y-2.5 rounded-xl border border-line bg-surface-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-content">{rule.name || "Regra sem nome"}</p>
            <p className="mt-0.5 text-[11px] text-content-muted">
              Conta de anúncio: <span className="font-medium text-content-secondary">{rule.pageLabel ?? rule.pageId ?? "—"}</span>
            </p>
            {rule.createdAtLabel ? (
              <p className="text-[11px] text-content-muted">Vinculada em {rule.createdAtLabel}</p>
            ) : null}
          </div>
        </div>
        <RuleStatusBadge active={rule.active} />
      </div>

      {formNamesLoading ? (
        <p className="text-xs text-content-muted">A verificar quais formulários estão ativos na Meta…</p>
      ) : activeFormIds.length === 0 ? (
        <p className="text-xs text-content-muted">
          Nenhum formulário ativo nesta regra — os vinculados foram arquivados na Meta.
        </p>
      ) : (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-faint">
            {activeFormIds.length} formulário{activeFormIds.length > 1 ? "s" : ""} ativo{activeFormIds.length > 1 ? "s" : ""}
            {archivedCount > 0 ? ` · ${archivedCount} arquivado${archivedCount > 1 ? "s" : ""} oculto${archivedCount > 1 ? "s" : ""}` : ""}
          </p>
          <ul className="space-y-1">
            {activeFormIds.map((formId) => (
              <li
                key={formId}
                className="flex items-baseline justify-between gap-2 rounded-lg bg-surface-deep/40 px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate font-medium text-content">
                  {formNames[formId] ?? formId}
                  {pageFailed ? (
                    <span className="ml-1.5 font-normal text-amber-600 dark:text-amber-300/90">(não confirmado)</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] text-content-faint">{formId}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OrganicRuleCard({ rule }: { rule: LeadDistributionRule }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-card p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
            <WhatsAppGlyph className="h-4 w-4 shrink-0" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-content">{rule.name || "Atendimento direto (WhatsApp)"}</p>
            <p className="mt-0.5 text-[11px] text-content-muted">
              O agente atende quem entra em contacto direto pelo WhatsApp, sem ser por formulário.
            </p>
            {rule.createdAtLabel ? (
              <p className="text-[11px] text-content-muted">Vinculada em {rule.createdAtLabel}</p>
            ) : null}
          </div>
        </div>
        <RuleStatusBadge active={rule.active} />
      </div>
    </div>
  );
}

export function WizardStep3Ativacao({
  agentId: agentIdProp,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  agentId?: string;
}) {
  const pathname = usePathname();
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);
  const [rules, setRules] = useState<LeadDistributionRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  // Só guarda nome para formulários ATIVOS — /api/client/meta/forms já filtra
  // status !== "ACTIVE" antes de responder (arquivados nunca entram aqui).
  const [formNames, setFormNames] = useState<Record<string, string>>({});
  const [formNamesLoading, setFormNamesLoading] = useState(false);
  const [failedPageIds, setFailedPageIds] = useState<Set<string>>(new Set());

  const agentIdFromPath = useMemo(() => {
    const match = pathname?.match(/\/dashboard\/agentes\/([^/]+)\/editar/);
    return match?.[1]?.trim() || null;
  }, [pathname]);

  const agentId = agentIdProp?.trim() || agentIdFromPath || resolvedAgentId;

  useEffect(() => {
    if (agentIdProp?.trim() || agentIdFromPath) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client/agentes", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = (await res.json()) as { agents?: { id: string; nome?: string }[] };
        if (!cancelled && data.agents?.length === 1) {
          setResolvedAgentId(data.agents[0]!.id);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentIdFromPath, agentIdProp]);

  useEffect(() => {
    if (!agentId) {
      setRules([]);
      setRulesLoading(false);
      return;
    }
    let cancelled = false;
    setRulesLoading(true);
    fetch("/api/client/lead-rules", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data: { rules?: LeadDistributionRule[] }) => {
        if (!cancelled) setRules(data.rules ?? []);
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      })
      .finally(() => {
        if (!cancelled) setRulesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const formRules = useMemo(() => (agentId ? getFormRulesForAgent(rules, agentId) : []), [rules, agentId]);
  const organicRules = useMemo(() => (agentId ? getOrganicRulesForAgent(rules, agentId) : []), [rules, agentId]);

  useEffect(() => {
    const pageIds = [...new Set(formRules.map((r) => r.pageId).filter((id): id is string => Boolean(id)))];
    if (pageIds.length === 0) {
      setFormNamesLoading(false);
      return;
    }
    let cancelled = false;
    setFormNamesLoading(true);
    (async () => {
      const nameEntries: Array<[string, string]> = [];
      const failed = new Set<string>();
      for (const pageId of pageIds) {
        try {
          const res = await fetch(`/api/client/meta/forms?page_id=${encodeURIComponent(pageId)}`, {
            credentials: "same-origin",
          });
          if (!res.ok) {
            failed.add(pageId);
            continue;
          }
          const data = (await res.json()) as { forms?: MetaFormsForm[] };
          for (const f of data.forms ?? []) {
            if (f.form_name) nameEntries.push([f.form_id, f.form_name]);
          }
        } catch {
          failed.add(pageId);
        }
      }
      if (!cancelled) {
        setFormNames((prev) => ({ ...prev, ...Object.fromEntries(nameEntries) }));
        setFailedPageIds(failed);
        setFormNamesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formRules.map((r) => r.pageId).join(",")]);

  const nothingLinked = formRules.length === 0 && organicRules.length === 0;

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-content">Quando este agente deve ser acionado?</h3>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Somente visualização — mostra exatamente o que está vinculado a este agente agora. Para vincular, trocar ou
          remover formulários e o atendimento direto, use{" "}
          <Link href="/dashboard/integracoes-leads" className="font-semibold text-primary underline-offset-2 hover:underline">
            Integrações de Leads
          </Link>
          .
        </p>
      </div>

      {!agentId ? (
        <p className="text-xs font-medium text-amber-600 dark:text-amber-300/90">
          Guarde o agente e abra novamente em modo edição para ver as origens vinculadas.
        </p>
      ) : rulesLoading ? (
        <p className="text-xs text-content-muted">A carregar origens vinculadas…</p>
      ) : nothingLinked ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line/80 bg-surface-card/60 p-4">
          <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-content-faint" strokeWidth={1.75} aria-hidden />
          <p className="text-xs leading-relaxed text-content-muted">
            Nenhuma origem vinculada a este agente ainda. Vá em{" "}
            <Link href="/dashboard/integracoes-leads" className="font-semibold text-primary underline-offset-2 hover:underline">
              Integrações de Leads
            </Link>{" "}
            para vincular um formulário Meta ou ativar o atendimento direto por WhatsApp.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {formRules.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-content-faint">Leads por formulário</p>
              <div className="space-y-2.5">
                {formRules.map((rule) => (
                  <FormRuleCard
                    key={rule.id}
                    rule={rule}
                    formNames={formNames}
                    formNamesLoading={formNamesLoading}
                    pageFailed={Boolean(rule.pageId && failedPageIds.has(rule.pageId))}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {organicRules.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-content-faint">Atendimento direto</p>
              <div className="space-y-2.5">
                {organicRules.map((rule) => (
                  <OrganicRuleCard key={rule.id} rule={rule} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
