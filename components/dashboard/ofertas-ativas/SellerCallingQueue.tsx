"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Phone } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelHelp } from "@/components/panel/ui/PanelHelp";
import {
  applyLeadDispositionFromApi,
  fetchActiveOfferDetailFromApi,
  type ActiveOfferDetail,
  type ActiveOfferLeadItem,
  type ActiveOfferSummary,
} from "@/lib/crm-active-offers-client";
import type { ActiveOfferDisposition } from "@/lib/active-offers-types";
import { cn } from "@/lib/utils";
import { ACTIVE_OFFERS_HELP } from "./active-offers-help";
import { FieldLabelWithHelp } from "./FieldLabelWithHelp";
import { SectionTitleWithHelp } from "./SectionTitleWithHelp";
import { formatDaysSinceContact, formatActiveOfferDate, phoneTelHref } from "./format-offer-date";

const DISPOSITION_BUTTONS: Array<{
  disposition: ActiveOfferDisposition;
  label: string;
  description: string;
  helpKey: keyof typeof ACTIVE_OFFERS_HELP;
  tone: string;
}> = [
  {
    disposition: "no_answer",
    label: "Não atendeu",
    description: "Fica na fila para tentar de novo",
    helpKey: "naoAtendeu",
    tone: "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15",
  },
  {
    disposition: "answered_transfer",
    label: "Atendeu — transferir p/ minha base",
    description: "Lead passa a ser seu no CRM",
    helpKey: "transferir",
    tone: "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15",
  },
  {
    disposition: "answered_not_interested",
    label: "Atendeu — não quer nada",
    description: "Marca como perdido no CRM",
    helpKey: "naoQuer",
    tone: "border-slate-500/30 bg-slate-500/10 hover:bg-slate-500/15",
  },
  {
    disposition: "do_not_call",
    label: "Pediu para não ligar",
    description: "Registra que não deve ser contatado",
    helpKey: "naoLigar",
    tone: "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15",
  },
];

function isPendingLead(lead: ActiveOfferLeadItem): boolean {
  const d = lead.progress.disposition;
  return d === "pending" || d === "no_answer";
}

export function SellerCallingQueue({
  offers,
  selectedOfferId,
  onSelectOffer,
  onRefreshOffers,
}: {
  offers: ActiveOfferSummary[];
  selectedOfferId: string | null;
  onSelectOffer: (id: string) => void;
  onRefreshOffers: () => void;
}) {
  const [detail, setDetail] = useState<ActiveOfferDetail | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingLeads = useMemo(
    () => (detail?.leads ?? []).filter(isPendingLead),
    [detail?.leads],
  );

  const currentLead = pendingLeads[currentIndex] ?? null;

  const stats = detail?.sellerProgress ?? detail?.progress;

  useEffect(() => {
    if (!selectedOfferId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchActiveOfferDetailFromApi(selectedOfferId, { sellerQueueOnly: true })
      .then((offer) => {
        if (!cancelled) {
          setDetail(offer);
          setCurrentIndex(0);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar fila.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOfferId]);

  const refreshDetail = useCallback(async () => {
    if (!selectedOfferId) return;
    const offer = await fetchActiveOfferDetailFromApi(selectedOfferId, { sellerQueueOnly: true });
    setDetail(offer);
    setCurrentIndex(0);
    onRefreshOffers();
  }, [selectedOfferId, onRefreshOffers]);

  const applyDisposition = useCallback(
    async (disposition: ActiveOfferDisposition) => {
      if (!selectedOfferId || !currentLead || busy) return;
      setBusy(true);
      setError(null);
      try {
        await applyLeadDispositionFromApi({
          offerId: selectedOfferId,
          leadId: currentLead.id,
          disposition,
          notes: notes.trim() || undefined,
        });
        setNotes("");
        await refreshDetail();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao registrar resultado.");
      } finally {
        setBusy(false);
      }
    },
    [selectedOfferId, currentLead, busy, notes, refreshDetail],
  );

  const telHref = currentLead ? phoneTelHref(currentLead.telefone) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
      <div className="space-y-3">
        <SectionTitleWithHelp title="Suas listas" help={ACTIVE_OFFERS_HELP.filaVendedor} />
        {offers.length ? (
          offers.map((offer) => (
            <button
              key={offer.id}
              type="button"
              className={cn(
                "w-full rounded-xl border p-4 text-left transition",
                selectedOfferId === offer.id
                  ? "border-primary/45 bg-primary/[0.08]"
                  : "border-line bg-surface-card hover:border-primary/30",
              )}
              onClick={() => onSelectOffer(offer.id)}
            >
              <p className="font-semibold text-content">{offer.title}</p>
              <p className="mt-1 text-xs text-content-muted">{formatActiveOfferDate(offer.createdAt)}</p>
              <p className="mt-3 text-sm text-content-muted">
                {offer.progress?.pending ?? offer.leadCount} aguardando · {offer.leadCount} total
              </p>
            </button>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-surface-card p-5 text-sm text-content-muted">
            Quando o diretor liberar uma lista para você, ela aparece aqui.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface-card p-4">
        <SectionTitleWithHelp title="Sua fila de ligações" help={ACTIVE_OFFERS_HELP.filaVendedor} className="mb-4" />

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-500">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            <div className="h-6 w-64 animate-pulse rounded bg-surface-elevated" />
            <div className="h-32 animate-pulse rounded-xl bg-surface-elevated/60" />
          </div>
        ) : !selectedOfferId ? (
          <p className="text-sm text-content-muted">Selecione uma lista na lateral para começar a ligar.</p>
        ) : !currentLead ? (
          <div className="rounded-xl border border-dashed border-line p-6 text-center">
            <p className="text-lg font-semibold text-content">Fila concluída!</p>
            <p className="mt-2 text-sm text-content-muted">
              {stats
                ? `${stats.completed} de ${stats.total} contatos finalizados nesta lista.`
                : "Todos os contatos desta lista foram trabalhados."}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {stats ? (
              <div>
                <div className="mb-2 flex items-center justify-between text-sm text-content-muted">
                  <span>Seu progresso</span>
                  <span>
                    {stats.completed} de {stats.total} contatos finalizados
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-elevated">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${stats.total ? (stats.completed / stats.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
              <div className="flex items-center gap-1.5">
                <p className="text-xs uppercase tracking-wide text-content-faint">Próximo contato</p>
                <PanelHelp content={ACTIVE_OFFERS_HELP.proximoContato} />
              </div>
              <h3 className="mt-1 text-xl font-semibold text-content">{currentLead.nome}</h3>
              <p className="mt-2 text-sm text-content-muted">
                {currentLead.telefone} · {currentLead.origem} · etapa {currentLead.status}
              </p>
              <p className="mt-1 text-sm text-content-muted">
                Último contato: {currentLead.ultimoContato} (
                {formatDaysSinceContact(currentLead.progress.daysSinceContact)})
              </p>
              {currentLead.progress.attemptCount > 0 ? (
                <p className="mt-1 text-sm text-amber-600">
                  Tentativas anteriores: {currentLead.progress.attemptCount}
                </p>
              ) : null}
              {telHref ? (
                <a
                  href={telHref}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/15"
                >
                  <Phone className="h-4 w-4" />
                  Ligar agora
                  <PanelHelp content={ACTIVE_OFFERS_HELP.ligarAgora} />
                </a>
              ) : null}
            </div>

            <FieldLabelWithHelp
              label="Observação (opcional)"
              htmlFor="call-notes"
              help={ACTIVE_OFFERS_HELP.observacao}
            />
            <Input
              id="call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: deixou recado na secretária"
            />

            <div className="grid gap-2 sm:grid-cols-2">
              {DISPOSITION_BUTTONS.map((btn) => (
                <button
                  key={btn.disposition}
                  type="button"
                  disabled={busy}
                  className={cn("relative rounded-xl border p-4 text-left transition disabled:opacity-60", btn.tone)}
                  onClick={() => void applyDisposition(btn.disposition)}
                >
                  <div className="absolute right-3 top-3">
                    <PanelHelp content={ACTIVE_OFFERS_HELP[btn.helpKey]} />
                  </div>
                  <p className="pr-8 font-semibold text-content">{btn.label}</p>
                  <p className="mt-1 text-xs text-content-muted">{btn.description}</p>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-line pt-4">
              <p className="text-sm text-content-muted">
                {currentIndex + 1} de {pendingLeads.length} na fila
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={currentIndex >= pendingLeads.length - 1}
                onClick={() => setCurrentIndex((i) => Math.min(i + 1, pendingLeads.length - 1))}
              >
                Pular por agora
                <PanelHelp content={ACTIVE_OFFERS_HELP.pularContato} />
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
