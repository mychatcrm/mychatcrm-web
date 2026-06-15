"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type { CommercialCoupon, CommercialPartner, CouponRedemption } from "@/lib/commercial/types";
import { PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { cn, formatBRL } from "@/lib/utils";

type ApiCouponRow = CommercialCoupon & { _uses?: number };

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

const emptyCoupon = (): Partial<CommercialCoupon> => ({
  code: "",
  internalName: "",
  description: "",
  discountType: "percent",
  discountValue: 10,
  validFrom: null,
  validUntil: null,
  maxRedemptionsTotal: null,
  maxRedemptionsPerUser: null,
  allowedPlanSlugs: [],
  discountRecurrence: "first_cycle",
  recurringCyclesLimit: null,
  active: true,
  partnerId: null,
  createPublicCode: true,
  stripeProductIds: [],
});

export function AdminCouponsWorkspace() {
  const [rows, setRows] = useState<ApiCouponRow[]>([]);
  const [partners, setPartners] = useState<CommercialPartner[]>([]);
  const [redemptions, setRedemptions] = useState<CouponRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<CommercialCoupon>>(emptyCoupon);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiCouponRow | null>(null);

  const clearFlashSoon = useCallback(() => {
    window.setTimeout(() => setFlash(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/coupons", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Falha ao carregar cupons.");
      const stats: { couponId: string; committedRedemptions: number }[] = data.redemptionStats ?? [];
      const map = new Map(stats.map((s) => [s.couponId, s.committedRedemptions]));
      const merged = (data.coupons as CommercialCoupon[]).map((c) => ({
        ...c,
        _uses: map.get(c.id) ?? 0,
      }));
      setRows(merged);
      setPartners(data.partners ?? []);
      setRedemptions(data.redemptions ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "active" && !r.active) return false;
      if (statusFilter === "inactive" && r.active) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.internalName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, statusFilter]);

  const openCreate = () => {
    setDraft(emptyCoupon());
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (c: CommercialCoupon) => {
    setDraft({
      ...c,
      validFrom: c.validFrom ?? "",
      validUntil: c.validUntil ?? "",
    });
    setFormError(null);
    setModalOpen(true);
  };

  const validateDraft = useCallback((d: Partial<CommercialCoupon>): string | null => {
    const code = String(d.code ?? "").trim();
    if (!code) return "Código do cupom é obrigatório.";
    const internalName = String(d.internalName ?? "").trim();
    if (!internalName) return "Nome interno é obrigatório.";

    const discountRaw = Number(d.discountValue);
    if (!Number.isFinite(discountRaw) || discountRaw < 0) return "Valor de desconto inválido.";
    if ((d.discountType ?? "percent") === "percent" && discountRaw > 100) {
      return "Percentual não pode exceder 100.";
    }

    const from = String(d.validFrom ?? "").trim();
    const until = String(d.validUntil ?? "").trim();
    if (from && until) {
      const fromTs = new Date(from).getTime();
      const untilTs = new Date(until).getTime();
      if (Number.isNaN(fromTs) || Number.isNaN(untilTs)) {
        return "Datas inválidas.";
      }
      if (fromTs > untilTs) {
        return "A data final deve ser igual ou posterior à data inicial.";
      }
    }

    return null;
  }, []);

  const save = async () => {
    setFormError(null);
    const v = validateDraft(draft);
    if (v) {
      setFormError(v);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          validFrom: draft.validFrom || null,
          validUntil: draft.validUntil || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível salvar.");
      setModalOpen(false);
      setFlash(draft.id ? "Cupom atualizado com sucesso." : "Cupom criado com sucesso.");
      clearFlashSoon();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    const c = pendingDelete;
    if (!c) return;
    setPendingDelete(null);
    try {
      const res = await fetch(`/api/admin/coupons/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Exclusão negada.");
      setFlash(`Cupom ${c.code} excluído.`);
      clearFlashSoon();
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao excluir.");
    }
  };

  const columns: Column<ApiCouponRow>[] = [
    {
      key: "code",
      header: "Código",
      render: (r) => <span className="font-mono text-xs font-semibold text-primary">{r.code}</span>,
    },
    {
      key: "name",
      header: "Nome interno",
      render: (r) => <span className="text-content-secondary">{r.internalName}</span>,
    },
    {
      key: "discount",
      header: "Desconto",
      render: (r) => (
        <span className="text-content-secondary">
          {r.discountType === "percent" ? `${r.discountValue}%` : centsToBRL(r.discountValue)}
        </span>
      ),
    },
    {
      key: "plans",
      header: "Planos",
      render: (r) => (
        <span className="text-xs text-content-muted">
          {r.allowedPlanSlugs?.length ? r.allowedPlanSlugs.join(", ") : "Todos"}
        </span>
      ),
    },
    {
      key: "uses",
      header: "Usos",
      render: (r) => <span className="tabular-nums text-content-secondary">{r._uses ?? 0}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        if (!r.active) {
          return <span className="text-xs font-medium text-content-faint">Inativo</span>;
        }
        const now = Date.now();
        if (r.validUntil != null && new Date(r.validUntil).getTime() < now) {
          return <span className="text-xs font-medium text-amber-400">Expirado</span>;
        }
        if (r.validFrom != null && new Date(r.validFrom).getTime() > now) {
          return <span className="text-xs font-medium text-blue-400">Não iniciado</span>;
        }
        return <span className="text-xs font-medium text-success">Ativo</span>;
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-[200px]",
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(r)}>
            Editar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPendingDelete(r)}>
            Excluir
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Cupons e descontos"
        description="Regras centralizadas no servidor. Checkout e admin usam as mesmas validações."
        actions={
          <Button type="button" onClick={openCreate}>
            Novo cupom
          </Button>
        }
      >
        {loadError ? (
          <p className="text-sm text-rose-400">{loadError}</p>
        ) : null}
        {flash ? <p className="text-sm text-emerald-400">{flash}</p> : null}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 sm:min-w-[200px]">
            <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">Buscar</label>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Código, nome ou descrição"
              className="mt-1.5"
            />
          </div>
          <div className="w-full sm:w-48">
            <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">Status</label>
            <Select className="mt-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </Select>
          </div>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            Atualizar
          </Button>
        </div>
        <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyLabel={loading ? "Carregando…" : "Nenhum cupom."} />
      </Panel>

      <Panel title="Resgates recentes" description="Últimos eventos gravados no checkout (ambiente demo — persistência em disco).">
        <ul className="space-y-2 text-sm text-content-secondary">
          {redemptions.slice(0, 12).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-card px-3 py-2">
              <span className="font-mono text-xs text-primary">{r.codeNormalized}</span>
              <span className="text-content-muted">{r.planSlug}</span>
              <span className="text-xs text-content-faint">{r.emailNormalized}</span>
              <span className="text-xs">
                −{centsToBRL(r.discountCents)} → {centsToBRL(r.finalCents)}
              </span>
              {r.status === "confirmed" && (
                <span className="text-xs font-medium text-success">Confirmado</span>
              )}
              {r.status === "pending" && (
                <span className="text-xs font-medium text-content-faint">Tentativa</span>
              )}
              {r.status === "committed" && (
                <span className="text-xs font-medium text-amber-400">Aguardando</span>
              )}
            </li>
          ))}
          {!redemptions.length ? <li className="text-content-muted">Nenhum resgate ainda.</li> : null}
        </ul>
      </Panel>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={draft.id ? "Editar cupom" : "Novo cupom"}
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
        {formError ? <p className="mb-3 text-sm text-rose-400">{formError}</p> : null}
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          <div className="sm:col-span-2 flex items-center gap-3 pt-1">
            <Toggle
              id="coupon-create-public-code"
              checked={draft.createPublicCode !== false}
              onChange={(v) => setDraft((d) => ({ ...d, createPublicCode: v }))}
              label="Criar código público (Promotion Code no Stripe)"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">
              {draft.createPublicCode !== false ? "Código público" : "Código interno"}
            </label>
            <Input
              className="mt-1.5 font-mono"
              value={draft.code ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              placeholder="SOLO15"
            />
            {draft.createPublicCode === false && (
              <p className="mt-1 text-xs text-content-faint">
                Nenhum Promotion Code será criado no Stripe — cupom interno, não digitável pelo cliente.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Nome interno</label>
            <Input
              className="mt-1.5"
              value={draft.internalName ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, internalName: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Descrição</label>
            <Input
              className="mt-1.5"
              value={draft.description ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Tipo</label>
            <Select
              className="mt-1.5"
              value={draft.discountType ?? "percent"}
              onChange={(e) => setDraft((d) => ({ ...d, discountType: e.target.value as CommercialCoupon["discountType"] }))}
            >
              <option value="percent">Percentual</option>
              <option value="fixed">Valor fixo (R$)</option>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">
              {draft.discountType === "fixed" ? "Valor (R$)" : "Percentual (%)"}
            </label>
            <Input
              type="number"
              className="mt-1.5"
              value={draft.discountType === "fixed" ? (draft.discountValue ?? 0) / 100 : (draft.discountValue ?? 0)}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!Number.isFinite(n)) return;
                setDraft((d) => ({
                  ...d,
                  discountValue: d.discountType === "fixed" ? Math.round(n * 100) : n,
                }));
              }}
            />
            {draft.discountType === "fixed" ? (
              <p className="mt-1 text-xs text-content-faint">Armazenado em centavos no servidor.</p>
            ) : null}
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Válido de (opcional)</label>
            <Input
              type="date"
              className="mt-1.5"
              value={draft.validFrom ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, validFrom: e.target.value || null }))}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Válido até (opcional)</label>
            <Input
              type="date"
              className="mt-1.5"
              value={draft.validUntil ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value || null }))}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Limite total (vazio = ilimitado)</label>
            <Input
              type="number"
              className="mt-1.5"
              value={draft.maxRedemptionsTotal ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  maxRedemptionsTotal: e.target.value === "" ? null : parseInt(e.target.value, 10),
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Limite por e-mail (vazio = ilimitado)</label>
            <Input
              type="number"
              className="mt-1.5"
              value={draft.maxRedemptionsPerUser ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  maxRedemptionsPerUser: e.target.value === "" ? null : parseInt(e.target.value, 10),
                }))
              }
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Restringir a planos (vazio = todos com checkout)</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLAN_CHECKOUT_SLUGS.map((slug) => {
                const on = draft.allowedPlanSlugs?.includes(slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() =>
                      setDraft((d) => {
                        const cur = d.allowedPlanSlugs ?? [];
                        const next = on ? cur.filter((s) => s !== slug) : [...cur, slug];
                        return { ...d, allowedPlanSlugs: next };
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      on ? "border-primary/40 bg-primary/15 text-content" : "border-line text-content-muted",
                    )}
                  >
                    {slug}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Duração do desconto (Stripe)</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["once", "repeating", "forever"] as const).map((opt) => {
                const active =
                  opt === "once"
                    ? draft.discountRecurrence === "first_cycle"
                    : opt === "repeating"
                      ? draft.discountRecurrence === "all_cycles" && draft.recurringCyclesLimit !== null
                      : draft.discountRecurrence === "all_cycles" && draft.recurringCyclesLimit === null;
                const label = opt === "once" ? "Uma vez" : opt === "repeating" ? "Vários meses" : "Vitalício";
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      if (opt === "once")
                        setDraft((d) => ({ ...d, discountRecurrence: "first_cycle", recurringCyclesLimit: null }));
                      else if (opt === "forever")
                        setDraft((d) => ({ ...d, discountRecurrence: "all_cycles", recurringCyclesLimit: null }));
                      else
                        setDraft((d) => ({
                          ...d,
                          discountRecurrence: "all_cycles",
                          recurringCyclesLimit: d.recurringCyclesLimit ?? 1,
                        }));
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active ? "border-primary/40 bg-primary/15 text-content" : "border-line text-content-muted",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {draft.discountRecurrence === "all_cycles" && draft.recurringCyclesLimit !== null && (
              <div className="mt-3">
                <label className="text-xs font-semibold text-content-muted">Quantos meses?</label>
                <Input
                  type="number"
                  className="mt-1.5"
                  min={1}
                  value={draft.recurringCyclesLimit ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      recurringCyclesLimit: e.target.value === "" ? 1 : parseInt(e.target.value, 10),
                    }))
                  }
                />
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-content-muted">Produtos Stripe (opcional)</label>
            <Input
              className="mt-1.5 font-mono text-xs"
              placeholder="prod_xxx, prod_yyy"
              value={(draft.stripeProductIds ?? []).join(", ")}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  stripeProductIds: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.startsWith("prod_")),
                }))
              }
            />
            <p className="mt-1 text-xs text-content-faint">
              Restringe o cupom a produtos Stripe específicos (applies_to.products). Product IDs em Stripe Dashboard → Products.
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold text-content-muted">Parceiro vinculado</label>
            <Select
              className="mt-1.5"
              value={draft.partnerId ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, partnerId: e.target.value || null }))}
            >
              <option value="">Nenhum</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end pb-1">
            <Toggle
              id="coupon-active"
              checked={draft.active !== false}
              onChange={(v) => setDraft((d) => ({ ...d, active: v }))}
              label="Cupom ativo"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Confirmar exclusão"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={() => void confirmDelete()}>
              Excluir
            </Button>
          </div>
        }
      >
        <p className="text-sm text-content-secondary">
          Deseja excluir o cupom{" "}
          <span className="font-mono font-semibold text-primary">{pendingDelete?.code}</span>?
        </p>
        {(pendingDelete?._uses ?? 0) > 0 && (
          <p className="mt-2 text-sm text-amber-400">
            Atenção: este cupom tem {pendingDelete?._uses} resgate
            {pendingDelete?._uses === 1 ? "" : "s"} confirmado
            {pendingDelete?._uses === 1 ? "" : "s"}. O histórico será preservado, mas o cupom e o
            código Stripe serão permanentemente removidos.
          </p>
        )}
        <p className="mt-2 text-xs text-content-faint">Esta ação é irreversível.</p>
      </Modal>
    </div>
  );
}
