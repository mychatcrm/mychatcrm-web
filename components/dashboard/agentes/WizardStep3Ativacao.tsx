"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { FileText } from "lucide-react";
import { WhatsAppGlyph } from "@/components/dashboard/crm/crm-phone";
import type { MetaFormsForm } from "@/app/api/client/meta/forms/route";
import type { AgentWizardDraft } from "@/lib/agents";
import { ORGANIC_WHATSAPP_SOURCE, type LeadDistributionRule } from "@/lib/lead-distribution-rules";
import { cn } from "@/lib/utils";

function getFormRulesForAgent(rules: LeadDistributionRule[], agentId: string): LeadDistributionRule[] {
  return rules.filter((r) => r.source === "meta_form" && r.agentIds.includes(agentId));
}

function getOrganicRuleForAgent(rules: LeadDistributionRule[], agentId: string): LeadDistributionRule | undefined {
  return rules.find((r) => r.source === ORGANIC_WHATSAPP_SOURCE && r.agentIds.includes(agentId));
}

type LinkedForm = { formId: string; pageId: string | null };

/** Formulários vinculados às regras do agente, deduplicados por form_id. */
function getLinkedForms(formRules: LeadDistributionRule[]): LinkedForm[] {
  const seen = new Set<string>();
  const out: LinkedForm[] = [];
  for (const rule of formRules) {
    for (const formId of rule.includedFormIds ?? []) {
      if (seen.has(formId)) continue;
      seen.add(formId);
      out.push({ formId, pageId: rule.pageId ?? null });
    }
  }
  return out;
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
  const organicRule = agentId ? getOrganicRuleForAgent(rules, agentId) : undefined;
  const linkedForms = useMemo(() => getLinkedForms(formRules), [formRules]);

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

  // Só mostra o que está confirmado ATIVO na Meta agora. Formulários cuja
  // página falhou ao consultar ficam visíveis mesmo assim (incerto — melhor
  // não esconder por erro de rede do que esconder um formulário ativo de verdade).
  const activeLinkedForms = useMemo(
    () =>
      linkedForms.filter(
        ({ formId, pageId }) => (pageId && failedPageIds.has(pageId)) || Boolean(formNames[formId]),
      ),
    [linkedForms, formNames, failedPageIds],
  );

  const activeMode: "formulario" | "organico" | null =
    activeLinkedForms.length > 0 ? "formulario" : organicRule ? "organico" : null;

  const cardSelectedClass = "border-primary bg-primary/10 ring-1 ring-inset ring-primary/30";
  const cardNeutralClass = "border-line/60 bg-surface-card/60 opacity-70";

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-content">Quando este agente deve ser acionado?</h3>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          Somente visualização — mostra o que já está vinculado a este agente. Para vincular ou trocar formulários e o
          atendimento direto, use{" "}
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
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div
              aria-disabled
              className={cn(
                "flex min-h-[100px] cursor-default flex-col items-start gap-3 rounded-xl border p-4 text-left",
                activeMode === "formulario" ? cardSelectedClass : cardNeutralClass,
              )}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold text-content">Leads por formulário</span>
                <span className="mt-1 block text-xs leading-relaxed text-content-muted">
                  {formRules.length === 0
                    ? "Nenhum formulário vinculado a este agente."
                    : formNamesLoading
                      ? "A verificar quais estão ativos na Meta…"
                      : activeLinkedForms.length > 0
                        ? `${activeLinkedForms.length} formulário${activeLinkedForms.length > 1 ? "s" : ""} ativo${activeLinkedForms.length > 1 ? "s" : ""}.`
                        : "Os formulários vinculados estão todos arquivados na Meta."}
                </span>
              </span>
            </div>

            <div
              aria-disabled
              className={cn(
                "flex min-h-[100px] cursor-default flex-col items-start gap-3 rounded-xl border p-4 text-left",
                activeMode === "organico" ? cardSelectedClass : cardNeutralClass,
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl",
                  activeMode === "organico" ? "bg-emerald-500/15 text-emerald-600" : "bg-surface-deep text-content-muted",
                )}
              >
                <WhatsAppGlyph className="h-6 w-6 shrink-0" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold text-content">Atendimento direto (WhatsApp)</span>
                <span className="mt-1 block text-xs leading-relaxed text-content-muted">
                  {organicRule ? "Ativo para este agente." : "Não vinculado a este agente."}
                </span>
              </span>
            </div>
          </div>

          {formRules.length > 0 ? (
            <section className="min-w-0 space-y-2 rounded-xl border border-line bg-surface-card p-3 sm:p-4">
              <p className="text-sm font-semibold text-content">Formulários ativos vinculados</p>
              {formNamesLoading ? (
                <p className="text-xs text-content-muted">A verificar formulários ativos na Meta…</p>
              ) : activeLinkedForms.length === 0 ? (
                <p className="text-xs text-content-muted">Nenhum formulário ativo — os vinculados foram arquivados na Meta.</p>
              ) : (
                <ul className="space-y-1.5">
                  {activeLinkedForms.map(({ formId, pageId }) => (
                    <li
                      key={formId}
                      className="rounded-lg border border-line/70 bg-surface-deep/40 px-3 py-2 text-xs text-content-secondary"
                    >
                      <span className="block font-medium text-content">
                        {formNames[formId] ?? formId}
                        {pageId && failedPageIds.has(pageId) ? (
                          <span className="ml-1.5 font-normal text-amber-600 dark:text-amber-300/90">
                            (não confirmado — falha ao consultar a Meta)
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-content-muted">{formId}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
