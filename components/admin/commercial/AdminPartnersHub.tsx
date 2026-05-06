"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { CommercialCoupon, CommercialPartner } from "@/lib/commercial/types";
import { cn, formatBRL } from "@/lib/utils";

function centsToBRL(cents: number) {
  return formatBRL(cents / 100);
}

function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content">{title}</h2>
          {description ? <p className="mt-1 text-sm text-content-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

type Metrics = {
  redemptionCount: number;
  revenueCents: number;
  discountCents: number;
  commissionCents: number;
  topCoupons: { couponId: string; code: string; count: number; discountCents: number }[];
  topPartners: { partnerId: string; name: string; code: string; commissionCents: number; redemptions: number }[];
};

const emptyPartner = (): Partial<CommercialPartner> => ({
  name: "",
  code: "",
  email: "",
  socialNotes: "",
  status: "active",
  observations: "",
  startedAt: new Date().toISOString().slice(0, 10),
  commissionType: "percent",
  commissionValue: 10,
  commissionTiming: "once",
  commissionRecurrenceMonths: null,
  campaignActive: true,
  linkedCouponIds: [],
});

export function AdminPartnersHub() {
  const [tab, setTab] = useState<"partners" | "metrics">("partners");
  const [partners, setPartners] = useState<CommercialPartner[]>([]);
  const [coupons, setCoupons] = useState<CommercialCoupon[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<CommercialPartner>>(emptyPartner());
  const [saving, setSaving] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const loadPartners = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/partners", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Falha ao carregar parceiros.");
      setPartners(data.partners ?? []);
      setCoupons(data.coupons ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    setMetricsError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/admin/commercial-metrics?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Falha nas métricas.");
      setMetrics(data as Metrics);
    } catch (e) {
      setMetricsError(e instanceof Error ? e.message : "Erro nas métricas.");
    }
  }, [from, to]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    if (tab === "metrics") void loadMetrics();
  }, [tab, loadMetrics]);

  const openCreate = () => {
    setDraft(emptyPartner());
    setModalOpen(true);
  };

  const openEdit = useCallback((p: CommercialPartner) => {
    setDraft({ ...p });
    setModalOpen(true);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível salvar.");
      setModalOpen(false);
      await loadPartners();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = useCallback(async (p: CommercialPartner) => {
    if (!confirm(`Excluir parceiro ${p.name}?`)) return;
    try {
      const res = await fetch(`/api/admin/partners/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Exclusão negada.");
      await loadPartners();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir.");
    }
  }, [loadPartners]);

  const columns: Column<CommercialPartner>[] = useMemo(
    () => [
      {
        key: "code",
        header: "Código",
        render: (p) => <span className="font-mono text-xs font-semibold text-primary">{p.code}</span>,
      },
      { key: "name", header: "Nome", render: (p) => <span className="text-content-secondary">{p.name}</span> },
      { key: "email", header: "E-mail", render: (p) => <span className="text-xs text-content-muted">{p.email}</span> },
      {
        key: "commission",
        header: "Comissão",
        render: (p) => (
          <span className="text-xs text-content-secondary">
            {p.commissionType === "percent" ? `${p.commissionValue}%` : centsToBRL(p.commissionValue)} ·{" "}
            {p.commissionTiming === "once" ? "única" : "recorrente"}
          </span>
        ),
      },
      {
        key: "camp",
        header: "Campanha",
        render: (p) => (
          <span className={cn("text-xs font-medium", p.campaignActive ? "text-success" : "text-content-faint")}>
            {p.campaignActive ? "Ativa" : "Pausada"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        className: "w-[200px]",
        render: (p) => (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(p)}>
              Editar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void remove(p)}>
              Excluir
            </Button>
          </div>
        ),
      },
    ],
    [openEdit, remove],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "partners" as const, label: "Parceiros & comissões" },
            { id: "metrics" as const, label: "Painel estratégico" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "min-h-[44px] rounded-xl border px-4 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-primary/40 bg-primary/15 text-content"
                : "border-line bg-surface-elevated/40 text-content-secondary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "partners" ? (
        <Panel
          title="Parcerias internas (premium)"
          description="Cadastro, comissões, campanhas e vínculo com cupons. Respeita permissões de admin."
          actions={
            <Button type="button" onClick={openCreate}>
              Novo parceiro
            </Button>
          }
        >
          {loadError ? <p className="mb-3 text-sm text-rose-400">{loadError}</p> : null}
          <DataTable
            columns={columns}
            data={partners}
            rowKey={(p) => p.id}
            emptyLabel={loading ? "Carregando…" : "Nenhum parceiro cadastrado."}
          />
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel
            title="Métricas comerciais"
            description="Baseada em resgates confirmados no checkout. Sincronize com webhooks do gateway quando disponível."
            actions={
              <Button type="button" variant="secondary" onClick={() => void loadMetrics()}>
                Atualizar
              </Button>
            }
          >
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">De</label>
                <Input type="date" className="mt-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">Até</label>
                <Input type="date" className="mt-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            {metricsError ? <p className="mb-3 text-sm text-rose-400">{metricsError}</p> : null}
            {metrics ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-line bg-surface-card p-4">
                  <p className="text-xs text-content-muted">Receita líquida (resgates)</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{centsToBRL(metrics.revenueCents)}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface-card p-4">
                  <p className="text-xs text-content-muted">Descontos concedidos</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{centsToBRL(metrics.discountCents)}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface-card p-4">
                  <p className="text-xs text-content-muted">Comissões estimadas</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{centsToBRL(metrics.commissionCents)}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface-card p-4">
                  <p className="text-xs text-content-muted">Resgates no período</p>
                  <p className="mt-2 text-2xl font-semibold text-content">{metrics.redemptionCount}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-content-muted">Carregando métricas…</p>
            )}
          </Panel>

          {metrics ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="Cupons mais usados">
                <ol className="space-y-2 text-sm text-content-secondary">
                  {metrics.topCoupons.map((c, i) => (
                    <li
                      key={c.couponId}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-card px-3 py-2"
                    >
                      <span>
                        <span className="text-content-faint">{i + 1}. </span>
                        <span className="font-mono text-primary">{c.code}</span>
                      </span>
                      <span>
                        {c.count} usos · {centsToBRL(c.discountCents)} desconto
                      </span>
                    </li>
                  ))}
                  {!metrics.topCoupons.length ? <li className="text-content-muted">Sem dados no período.</li> : null}
                </ol>
              </Panel>
              <Panel title="Parceiros top (comissão)">
                <ol className="space-y-2 text-sm text-content-secondary">
                  {metrics.topPartners.map((p, i) => (
                    <li
                      key={p.partnerId}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-card px-3 py-2"
                    >
                      <span>
                        <span className="text-content-faint">{i + 1}. </span>
                        {p.name}{" "}
                        <span className="text-xs text-content-faint">({p.code})</span>
                      </span>
                      <span>{centsToBRL(p.commissionCents)}</span>
                    </li>
                  ))}
                  {!metrics.topPartners.length ? <li className="text-content-muted">Sem comissões no período.</li> : null}
                </ol>
              </Panel>
            </div>
          ) : null}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={draft.id ? "Editar parceiro" : "Novo parceiro"}
        className="max-w-3xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void save()} isLoading={saving}>
              Salvar
            </Button>
          </div>
        }
      >
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-content-muted">Nome</label>
            <Input className="mt-1.5" value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Código interno</label>
            <Input className="mt-1.5 font-mono" value={draft.code ?? ""} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">E-mail</label>
            <Input className="mt-1.5" type="email" value={draft.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Redes / links</label>
            <Input className="mt-1.5" value={draft.socialNotes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, socialNotes: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Data início</label>
            <Input type="date" className="mt-1.5" value={draft.startedAt ?? ""} onChange={(e) => setDraft((d) => ({ ...d, startedAt: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Status</label>
            <Select
              className="mt-1.5"
              value={draft.status ?? "active"}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as CommercialPartner["status"] }))}
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Observações</label>
            <Input className="mt-1.5" value={draft.observations ?? ""} onChange={(e) => setDraft((d) => ({ ...d, observations: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Tipo comissão</label>
            <Select
              className="mt-1.5"
              value={draft.commissionType ?? "percent"}
              onChange={(e) => setDraft((d) => ({ ...d, commissionType: e.target.value as CommercialPartner["commissionType"] }))}
            >
              <option value="percent">Percentual</option>
              <option value="fixed">Fixo (R$)</option>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">{draft.commissionType === "fixed" ? "Valor (R$)" : "Percentual"}</label>
            <Input
              type="number"
              className="mt-1.5"
              value={
                draft.commissionType === "fixed"
                  ? (draft.commissionValue ?? 0) / 100
                  : (draft.commissionValue ?? 0)
              }
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!Number.isFinite(n)) return;
                setDraft((d) => ({
                  ...d,
                  commissionValue: d.commissionType === "fixed" ? Math.round(n * 100) : n,
                }));
              }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Pagamento comissão</label>
            <Select
              className="mt-1.5"
              value={draft.commissionTiming ?? "once"}
              onChange={(e) => setDraft((d) => ({ ...d, commissionTiming: e.target.value as CommercialPartner["commissionTiming"] }))}
            >
              <option value="once">Única (1º pagamento)</option>
              <option value="recurring">Recorrente</option>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Meses recorrentes (opcional)</label>
            <Input
              type="number"
              className="mt-1.5"
              placeholder="vazio = conforme contrato"
              value={draft.commissionRecurrenceMonths ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  commissionRecurrenceMonths: e.target.value === "" ? null : parseInt(e.target.value, 10),
                }))
              }
            />
          </div>
          <div className="flex items-end pb-1 sm:col-span-2">
            <Toggle
              id="camp-active"
              checked={draft.campaignActive !== false}
              onChange={(v) => setDraft((d) => ({ ...d, campaignActive: v }))}
              label="Campanha ativa"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Cupons vinculados</label>
            <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-xl border border-line bg-surface-deep/50 p-3">
              {coupons.map((c) => {
                const on = draft.linkedCouponIds?.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setDraft((d) => {
                        const cur = d.linkedCouponIds ?? [];
                        const next = on ? cur.filter((x) => x !== c.id) : [...cur, c.id];
                        return { ...d, linkedCouponIds: next };
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      on ? "border-primary/40 bg-primary/15 text-content" : "border-line text-content-muted",
                    )}
                  >
                    {c.code}
                  </button>
                );
              })}
              {!coupons.length ? <span className="text-xs text-content-muted">Cadastre cupons primeiro.</span> : null}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
