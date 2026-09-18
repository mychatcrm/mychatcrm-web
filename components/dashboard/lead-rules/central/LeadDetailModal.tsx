"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import { bucketMetaLeadEventStep } from "@/lib/meta-lead-event-status";
import { OUTCOME_LABEL } from "@/lib/meta-leads/outcome-labels";

type FormFieldEntry = { key: string; label: string; value: string };
type StepEntry = { step: string; at: string; detail?: Record<string, unknown> };

export type LeadDetail = {
  id: string;
  leadgen_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  page_id: string;
  page_name: string | null;
  form_id: string | null;
  form_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  lead_id: string | null;
  agent_id: string | null;
  agent_resolution_source: string | null;
  crm_sync_status: string;
  whatsapp_status: string;
  current_step: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  form_fields: FormFieldEntry[];
  steps_log: StepEntry[];
  profile_metadata: Record<string, unknown>;
  outcome?: LeadOutcome | null;
};

/** Resultado comercial vindo do CRM — preenchido pela junção da fase 3. */
export type LeadOutcome = {
  status: string | null;
  funnelId: string | null;
  columnLabel: string | null;
  value: number | null;
  ownerName: string | null;
  teamName: string | null;
  respondedAt: string | null;
  firstReplyMinutes: number | null;
  scheduledAt: string | null;
  scheduleStatus: string | null;
  temperature: string | null;
  outcome: string;
};

const BUCKET_STYLE: Record<string, string> = {
  novo: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sem_regra: "border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200",
  erro: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

const BUCKET_LABEL: Record<string, string> = {
  novo: "Novo",
  ok: "OK",
  sem_regra: "Sem regra",
  erro: "Erro",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { isLight } = usePanelAppearance();
  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        isLight ? "border-slate-200 bg-white" : "border-line/70 bg-surface-deep/40",
      )}
    >
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-content-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-content-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-medium text-content">{value ?? "—"}</dd>
    </div>
  );
}

export function LeadDetailModal({
  eventId,
  onClose,
  onArchivedChange,
  agentNames,
}: {
  eventId: string | null;
  onClose: () => void;
  onArchivedChange?: (eventId: string, archived: boolean) => void;
  agentNames: Map<string, string>;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/client/meta/lead-events/${encodeURIComponent(eventId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as { event?: LeadDetail; error?: string };
        if (!response.ok || !json.event) throw new Error(json.error ?? "Não foi possível abrir o lead.");
        if (!cancelled) setDetail(json.event);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao abrir o lead.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const toggleArchive = useCallback(async () => {
    if (!detail) return;
    const archiving_ = !detail.archived_at;
    setArchiving(true);
    try {
      const response = await fetch(
        `/api/client/meta/lead-events/${encodeURIComponent(detail.id)}/archive`,
        { method: archiving_ ? "POST" : "DELETE", credentials: "same-origin" },
      );
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Não foi possível arquivar.");
      setDetail({ ...detail, archived_at: archiving_ ? new Date().toISOString() : null });
      onArchivedChange?.(detail.id, archiving_);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao arquivar.");
    } finally {
      setArchiving(false);
    }
  }, [detail, onArchivedChange]);

  const bucket = detail ? bucketMetaLeadEventStep(detail.current_step) : "novo";

  return (
    <Modal
      open={Boolean(eventId)}
      onClose={onClose}
      title={detail?.name?.trim() || "Lead"}
      className="w-full sm:max-w-3xl"
      footer={
        detail ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void toggleArchive()} disabled={archiving}>
              {archiving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : detail.archived_at ? (
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Archive className="h-3.5 w-3.5" aria-hidden />
              )}
              {detail.archived_at ? "Restaurar" : "Arquivar"}
            </Button>
            {detail.lead_id ? (
              <Link
                href={`/dashboard/crm?lead=${detail.lead_id}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                Abrir no CRM
                <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-content-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Carregando lead…
        </div>
      ) : error ? (
        <p className="py-10 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : detail ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("text-[10px]", BUCKET_STYLE[bucket])}>{BUCKET_LABEL[bucket]}</Badge>
            {detail.archived_at ? (
              <Badge className="border-line bg-surface-elevated/70 text-[10px] text-content-muted">Arquivado</Badge>
            ) : null}
            {detail.outcome ? (
              <Badge className="border-primary/30 bg-primary/10 text-[10px] text-primary">
                {OUTCOME_LABEL[detail.outcome.outcome] ?? detail.outcome.outcome}
              </Badge>
            ) : null}
          </div>

          <Section title="Contato">
            <dl className="divide-y divide-line/30">
              <Row label="Nome" value={detail.name || "—"} />
              <Row label="Telefone" value={detail.phone || "—"} />
              <Row label="E-mail" value={detail.email || "—"} />
              <Row label="Recebido em" value={formatDateTime(detail.created_at)} />
            </dl>
          </Section>

          {/* As respostas do formulário estão gravadas desde o primeiro lead e
              nunca tinham sido mostradas em lugar nenhum do painel. */}
          <Section title={`Respostas do formulário${detail.form_fields.length ? ` (${detail.form_fields.length})` : ""}`}>
            {detail.form_fields.length === 0 ? (
              <p className="text-xs text-content-muted">
                Este lead não trouxe respostas — ou o formulário só pede os campos de contato.
              </p>
            ) : (
              <dl className="space-y-2.5">
                {detail.form_fields.map((field) => (
                  <div key={`${field.key}-${field.label}`} className="min-w-0">
                    <dt className="text-[11px] text-content-muted">{field.label}</dt>
                    <dd className="break-words text-sm font-medium text-content">{field.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Origem do anúncio">
            <dl className="divide-y divide-line/30">
              <Row label="Campanha" value={detail.campaign_name || detail.campaign_id || "—"} />
              <Row label="Conjunto" value={detail.adset_name || detail.adset_id || "—"} />
              <Row label="Anúncio" value={detail.ad_name || detail.ad_id || "—"} />
              <Row label="Formulário" value={detail.form_name || detail.form_id || "—"} />
              <Row label="Página" value={detail.page_name || detail.page_id} />
            </dl>
          </Section>

          {detail.outcome ? (
            <Section title="Resultado">
              <dl className="divide-y divide-line/30">
                <Row label="Etapa no funil" value={detail.outcome.columnLabel || detail.outcome.status || "—"} />
                <Row
                  label="Respondeu em"
                  value={
                    detail.outcome.firstReplyMinutes === null
                      ? "Sem resposta"
                      : detail.outcome.firstReplyMinutes < 60
                        ? `${detail.outcome.firstReplyMinutes} min`
                        : `${Math.round(detail.outcome.firstReplyMinutes / 60)} h`
                  }
                />
                <Row label="Agendamento" value={formatDateTime(detail.outcome.scheduledAt)} />
                <Row label="Responsável" value={detail.outcome.ownerName || "—"} />
                <Row label="Equipe" value={detail.outcome.teamName || "—"} />
              </dl>
            </Section>
          ) : null}

          <Section title="Atendimento">
            <dl className="divide-y divide-line/30">
              <Row
                label="Agente"
                value={detail.agent_id ? (agentNames.get(detail.agent_id) ?? detail.agent_id) : "Nenhum"}
              />
              <Row label="Como foi decidido" value={detail.agent_resolution_source || "—"} />
              <Row label="CRM" value={detail.crm_sync_status} />
              <Row label="WhatsApp" value={detail.whatsapp_status} />
              {detail.error_message ? <Row label="Erro" value={detail.error_message} /> : null}
            </dl>
          </Section>

          <Section title="Linha do tempo">
            <ol className="space-y-2">
              {detail.steps_log.length === 0 ? (
                <li className="text-xs text-content-muted">Sem passos registados.</li>
              ) : (
                detail.steps_log.map((step, index) => (
                  <li key={`${step.step}-${index}`} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 tabular-nums text-content-faint">{formatDateTime(step.at)}</span>
                    <span className="min-w-0 flex-1 text-content-secondary">{step.step}</span>
                  </li>
                ))
              )}
            </ol>
          </Section>

          <p className="text-center text-[10px] text-content-faint">Leadgen ID {detail.leadgen_id}</p>
        </div>
      ) : null}
    </Modal>
  );
}
