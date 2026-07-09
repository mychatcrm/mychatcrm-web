"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, Plus } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import type { ClientSession } from "@/lib/client-auth";
import {
  archiveActiveOfferFromApi,
  fetchActiveOfferDetailFromApi,
  fetchActiveOffersFromApi,
  fetchOfferProgressBySellerFromApi,
  type ActiveOfferDetail,
  type ActiveOfferSummary,
} from "@/lib/crm-active-offers-client";
import { resolveOrganizationRole } from "@/lib/organization-role";
import type { TeamEmployee } from "@/lib/team-employees-types";
import { cn } from "@/lib/utils";
import { ActiveOffersPanel } from "./ActiveOffersPanel";
import { DirectorOfferBuilder } from "./DirectorOfferBuilder";
import { formatActiveOfferDate } from "./format-offer-date";
import { OfferProgressPanel } from "./OfferProgressPanel";
import { SellerCallingQueue } from "./SellerCallingQueue";

export function ActiveOffersHub({ session }: { session: ClientSession }) {
  const searchParams = useSearchParams();
  const initialOfferId = searchParams.get("offer");
  const role = resolveOrganizationRole(session);
  const canCreate = role === "owner" || role === "director";
  const isSeller = role === "seller";
  const canMonitor = role === "owner" || role === "director" || role === "manager";

  const [offers, setOffers] = useState<ActiveOfferSummary[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(initialOfferId);
  const [selectedOffer, setSelectedOffer] = useState<ActiveOfferDetail | null>(null);
  const [sellerProgressRows, setSellerProgressRows] = useState<
    Array<{ employeeId: string; stats: ActiveOfferDetail["progress"] extends infer P ? NonNullable<P> : never }>
  >([]);
  const [employees, setEmployees] = useState<TeamEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const employeeNames = useMemo(
    () => new Map(employees.filter((e) => e.ativo).map((e) => [e.id, e.nome])),
    [employees],
  );

  const loadOffers = useCallback(async () => {
    setError(null);
    const rows = await fetchActiveOffersFromApi();
    setOffers(rows);
    setSelectedOfferId((prev) => prev || rows[0]?.id || null);
    return rows;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      loadOffers().catch(() => {
        if (!cancelled) setError("Não foi possível carregar as listas de ligação.");
      }),
      canCreate || canMonitor
        ? fetch("/api/team-employees", { cache: "no-store" })
            .then((res) => res.json())
            .then((data: { employees?: TeamEmployee[] }) => {
              if (!cancelled) setEmployees(Array.isArray(data.employees) ? data.employees : []);
            })
            .catch(() => undefined)
        : Promise.resolve(),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadOffers, canCreate, canMonitor]);

  useEffect(() => {
    if (!selectedOfferId || isSeller) {
      setSelectedOffer(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetchActiveOfferDetailFromApi(selectedOfferId)
      .then((offer) => {
        if (!cancelled) setSelectedOffer(offer);
      })
      .catch(() => {
        if (!cancelled) setSelectedOffer(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    if (canMonitor) {
      void fetchOfferProgressBySellerFromApi(selectedOfferId)
        .then((rows) => {
          if (!cancelled) setSellerProgressRows(rows);
        })
        .catch(() => {
          if (!cancelled) setSellerProgressRows([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedOfferId, isSeller, canMonitor]);

  const handleCreated = useCallback(
    async (offer: ActiveOfferSummary) => {
      setShowBuilder(false);
      await loadOffers();
      setSelectedOfferId(offer.id);
    },
    [loadOffers],
  );

  const handleArchive = useCallback(async () => {
    if (!selectedOfferId || archiving) return;
    setArchiving(true);
    setError(null);
    try {
      await archiveActiveOfferFromApi(selectedOfferId);
      await loadOffers();
      setSelectedOfferId(null);
      setSelectedOffer(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao arquivar lista.");
    } finally {
      setArchiving(false);
    }
  }, [selectedOfferId, archiving, loadOffers]);

  return (
    <ActiveOffersPanel
      title="Ofertas ativas"
      description="Listas de ligação para reativar leads em massa. Diretor e dono montam e distribuem; vendedores trabalham a fila com resultados que atualizam o CRM."
      actions={
        canCreate ? (
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setShowBuilder((v) => !v)}>
            <Plus className="h-4 w-4" />
            {showBuilder ? "Fechar criador" : "Nova lista"}
          </Button>
        ) : null
      }
    >
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-500">
          {error}
        </div>
      ) : null}

      {canCreate && showBuilder ? (
        <div className="mb-6">
          <DirectorOfferBuilder employees={employees} onCreated={(offer) => void handleCreated(offer)} />
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl border border-line bg-surface-elevated/40" />
          ))}
        </div>
      ) : isSeller ? (
        <SellerCallingQueue
          offers={offers.filter((o) => !o.archivedAt)}
          selectedOfferId={selectedOfferId}
          onSelectOffer={setSelectedOfferId}
          onRefreshOffers={() => void loadOffers()}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <div className="space-y-3">
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
                    offer.archivedAt ? "opacity-70" : "",
                  )}
                  onClick={() => setSelectedOfferId(offer.id)}
                >
                  <p className="font-semibold text-content">{offer.title}</p>
                  <p className="mt-1 text-xs text-content-muted">{formatActiveOfferDate(offer.createdAt)}</p>
                  <p className="mt-3 text-sm text-content-muted">
                    {offer.leadCount} {offer.leadCount === 1 ? "lead" : "leads"}
                    {offer.archivedAt ? " · arquivada" : ""}
                  </p>
                  {offer.progress ? (
                    <p className="mt-1 text-xs text-content-faint">
                      {offer.progress.completed}/{offer.progress.total} concluídos
                    </p>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-surface-card p-5 text-sm text-content-muted">
                {canCreate
                  ? "Nenhuma lista criada ainda. Use “Nova lista” para montar a primeira campanha de ligação."
                  : "Nenhuma lista disponível no momento."}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {detailLoading ? (
              <div className="rounded-xl border border-line bg-surface-card p-4">
                <div className="h-6 w-64 animate-pulse rounded bg-surface-elevated" />
                <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-elevated/60" />
              </div>
            ) : selectedOffer ? (
              <>
                <div className="rounded-xl border border-line bg-surface-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-content">{selectedOffer.title}</h3>
                      <p className="mt-1 text-sm text-content-muted">
                        Criada em {formatActiveOfferDate(selectedOffer.createdAt)}
                        {selectedOffer.createdVia === "smart_filter" ? " · filtro inteligente" : " · CRM manual"}
                      </p>
                    </div>
                    {canCreate && !selectedOffer.archivedAt ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        disabled={archiving}
                        onClick={() => void handleArchive()}
                      >
                        <Archive className="h-4 w-4" />
                        {archiving ? "Arquivando..." : "Arquivar"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {canMonitor ? (
                  <OfferProgressPanel
                    stats={selectedOffer.progress}
                    sellerRows={sellerProgressRows}
                    employeeNames={employeeNames}
                  />
                ) : null}

                <div className="rounded-xl border border-line bg-surface-card p-4">
                  <p className="mb-3 text-sm font-medium text-content">Leads vinculados (amostra)</p>
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {selectedOffer.leads.slice(0, 50).map((lead) => (
                      <div key={lead.id} className="rounded-lg border border-line bg-surface-elevated/35 p-3 text-sm">
                        <p className="font-medium text-content">{lead.nome}</p>
                        <p className="mt-1 text-content-muted">
                          {lead.telefone} · {lead.origem} · {lead.progress.disposition}
                        </p>
                      </div>
                    ))}
                    {!selectedOffer.leads.length ? (
                      <p className="text-sm text-content-muted">Esta lista ainda não tem leads vinculados.</p>
                    ) : null}
                    {selectedOffer.leads.length > 50 ? (
                      <p className="text-xs text-content-faint">Mostrando 50 de {selectedOffer.leads.length} leads.</p>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-content-muted">Selecione uma lista para ver o progresso e os leads.</p>
            )}
          </div>
        </div>
      )}
    </ActiveOffersPanel>
  );
}
