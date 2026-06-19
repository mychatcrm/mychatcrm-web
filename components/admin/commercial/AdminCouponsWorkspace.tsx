"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { CouponFormModal } from "@/components/admin/commercial/CouponFormModal";
import type {
  CommercialCoupon,
  CommercialPartner,
  CouponExtraCode,
  CouponRedemption,
} from "@/lib/commercial/types";
import { isInternalTestProvisioningCoupon } from "@/lib/commercial/internal-test-coupon";
import { PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { formatBRL } from "@/lib/utils";

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

export function AdminCouponsWorkspace() {
  const [rows, setRows] = useState<ApiCouponRow[]>([]);
  const [partners, setPartners] = useState<CommercialPartner[]>([]);
  const [redemptions, setRedemptions] = useState<CouponRedemption[]>([]);
  const [extraCodes, setExtraCodes] = useState<CouponExtraCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CommercialCoupon | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiCouponRow | null>(null);
  const [redemptionSearch, setRedemptionSearch] = useState("");
  const [redemptionStatusFilter, setRedemptionStatusFilter] = useState<
    "all" | "pending" | "committed" | "confirmed"
  >("all");
  const [redemptionPlanFilter, setRedemptionPlanFilter] = useState("all");
  const [pendingDeleteRedemption, setPendingDeleteRedemption] = useState<CouponRedemption | null>(null);

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
      setExtraCodes(data.extraCodes ?? []);
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

  const filteredRedemptions = useMemo(() => {
    const q = redemptionSearch.trim().toLowerCase();
    return redemptions.filter((r) => {
      if (redemptionStatusFilter !== "all" && r.status !== redemptionStatusFilter) return false;
      if (redemptionPlanFilter !== "all" && r.planSlug !== redemptionPlanFilter) return false;
      if (q && !r.codeNormalized.toLowerCase().includes(q) && !r.emailNormalized.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [redemptions, redemptionSearch, redemptionStatusFilter, redemptionPlanFilter]);

  const openCreate = () => {
    setEditingCoupon(null);
    setFormOpen(true);
  };

  const openEdit = (c: CommercialCoupon) => {
    setEditingCoupon(c);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditingCoupon(null);
  };

  const handleFormSaved = async () => {
    setFlash(editingCoupon ? "Cupom atualizado com sucesso." : "Cupom criado com sucesso.");
    clearFlashSoon();
    await load();
  };

  const confirmDeleteRedemption = async () => {
    const r = pendingDeleteRedemption;
    if (!r) return;
    setPendingDeleteRedemption(null);
    try {
      const res = await fetch(`/api/admin/coupons/redemptions/${encodeURIComponent(r.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Erro ao apagar.");
      setRedemptions((prev) => prev.filter((x) => x.id !== r.id));
      setFlash("Registro apagado.");
      clearFlashSoon();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erro ao apagar registro.");
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
      render: (r) => {
        const extras = extraCodes.filter((e) => e.couponId === r.id);
        return (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-xs font-semibold text-primary">{r.code}</span>
            {extras.map((e) => (
              <span key={e.id} className="font-mono text-xs text-content-faint">
                +{e.code}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: "name",
      header: "Nome interno",
      render: (r) => (
        <div className="flex flex-col gap-1">
          <span className="text-content-secondary">{r.internalName}</span>
          {isInternalTestProvisioningCoupon(r) ? (
            <span className="w-fit rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
              Cupom interno de teste · sem Stripe
            </span>
          ) : null}
        </div>
      ),
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
        if (isInternalTestProvisioningCoupon(r)) {
          return <span className="text-xs font-medium text-amber-400">Teste interno</span>;
        }
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
        if (r.createPublicCode !== false && !r.stripePromoCodeId) {
          return <span className="text-xs font-medium text-amber-400">Sem Stripe</span>;
        }
        return <span className="text-xs font-medium text-success">Ativo</span>;
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-[200px]",
      render: (r) => {
        const isInternal = isInternalTestProvisioningCoupon(r);
        return (
          <div className="flex flex-wrap gap-2">
            {!isInternal ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(r)}>
                Editar
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => setPendingDelete(r)}>
              Excluir
            </Button>
          </div>
        );
      },
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
        {loadError ? <p className="text-sm text-rose-400">{loadError}</p> : null}
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
            <Select
              className="mt-1.5"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </Select>
          </div>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            Atualizar
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => r.id}
          emptyLabel={loading ? "Carregando…" : "Nenhum cupom."}
        />
      </Panel>

      <Panel title="Resgates recentes" description="Eventos gravados no checkout. Filtros aplicados no frontend.">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 sm:min-w-[180px]">
            <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">Buscar</label>
            <Input
              className="mt-1.5"
              value={redemptionSearch}
              onChange={(e) => setRedemptionSearch(e.target.value)}
              placeholder="Código ou email"
            />
          </div>
          <div className="w-full sm:w-44">
            <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">Status</label>
            <Select
              className="mt-1.5"
              value={redemptionStatusFilter}
              onChange={(e) => setRedemptionStatusFilter(e.target.value as typeof redemptionStatusFilter)}
            >
              <option value="all">Todos</option>
              <option value="pending">Tentativa</option>
              <option value="committed">Aguardando</option>
              <option value="confirmed">Confirmado</option>
            </Select>
          </div>
          <div className="w-full sm:w-40">
            <label className="text-xs font-semibold uppercase tracking-wider text-content-muted">Plano</label>
            <Select
              className="mt-1.5"
              value={redemptionPlanFilter}
              onChange={(e) => setRedemptionPlanFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              {PLAN_CHECKOUT_SLUGS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <ul className="space-y-2 text-sm text-content-secondary">
          {filteredRedemptions.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-card px-3 py-2"
            >
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
              <button
                type="button"
                onClick={() => setPendingDeleteRedemption(r)}
                className="ml-auto text-content-faint transition-colors hover:text-rose-400"
                title="Apagar registro"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
            </li>
          ))}
          {!filteredRedemptions.length && (
            <li className="text-content-muted">
              {redemptions.length === 0 ? "Nenhum resgate ainda." : "Nenhum resgate encontrado."}
            </li>
          )}
        </ul>
      </Panel>

      <CouponFormModal
        open={formOpen}
        coupon={editingCoupon}
        partners={partners}
        onClose={handleFormClose}
        onSaved={handleFormSaved}
      />

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
            {pendingDelete?._uses === 1 ? "" : "s"}. O histórico será preservado, mas o cupom e o código Stripe serão
            permanentemente removidos.
          </p>
        )}
        <p className="mt-2 text-xs text-content-faint">Esta ação é irreversível.</p>
        {isInternalTestProvisioningCoupon(pendingDelete) ? (
          <p className="mt-2 text-xs text-amber-400">
            Ao excluir este cupom, o atalho interno TEST100 deixa de criar contas de teste sem Stripe.
          </p>
        ) : null}
      </Modal>

      <Modal
        open={pendingDeleteRedemption !== null}
        onClose={() => setPendingDeleteRedemption(null)}
        title="Apagar registro"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingDeleteRedemption(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" onClick={() => void confirmDeleteRedemption()}>
              Apagar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-content-secondary">
          Deseja apagar o resgate{" "}
          <span className="font-mono font-semibold text-primary">{pendingDeleteRedemption?.codeNormalized}</span> de{" "}
          <span className="text-content">{pendingDeleteRedemption?.emailNormalized}</span>?
        </p>
        <p className="mt-2 text-xs text-content-faint">Esta ação é irreversível.</p>
      </Modal>
    </div>
  );
}
