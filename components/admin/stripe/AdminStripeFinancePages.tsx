"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import type {
  AdminStripeChurnRow,
  AdminStripeFaturaRow,
  AdminStripeFinanceiroPayload,
  AdminStripePagamentoRow,
} from "@/lib/admin-stripe-types";

const POLL_MS = 15_000;
const DEBOUNCE_MS = 450;

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
    <section className="panel-surface-card min-w-0 rounded-xl border border-line bg-surface-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold text-content sm:text-xl">{title}</h2>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="panel-surface-card panel-kpi-card rounded-xl border border-line bg-surface-card p-4">
      <p className="text-sm text-content-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-content">{value}</p>
      <p className="mt-2 text-xs text-content-faint">{helper}</p>
    </div>
  );
}

function defaultDateRangeStrings() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function formatCents(currency: string, cents: number) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${cents / 100}`;
  }
}

function FinanceBars({
  series,
}: {
  series: { day: string; grossCents: number; refundedCents: number }[];
}) {
  const normalized = useMemo(() => {
    const maxG = Math.max(1, ...series.map((s) => s.grossCents));
    const maxR = Math.max(1, ...series.map((s) => s.refundedCents));
    return series.map((s) => ({
      label: s.day.slice(8, 10) + "/" + s.day.slice(5, 7),
      grossPct: Math.round((s.grossCents / maxG) * 100),
      refPct: Math.round((s.refundedCents / maxR) * 100),
    }));
  }, [series]);

  if (!normalized.length) return <p className="text-sm text-content-faint">Sem série diária no período (sem cobranças indexadas).</p>;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-3 text-xs font-medium uppercase text-content-faint">Bruto cobrado (por dia)</p>
        <div className="space-y-3">
          {normalized.map((item) => (
            <div key={`g-${item.label}`}>
              <div className="mb-1 flex justify-between text-xs text-content-secondary">
                <span>{item.label}</span>
                <span>{item.grossPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-line/40 ring-1 ring-inset ring-line/50">
                <div className="h-2 rounded-full bg-[linear-gradient(90deg,#F24400,#B22A00)]" style={{ width: `${item.grossPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 text-xs font-medium uppercase text-content-faint">Reembolsos (por dia)</p>
        <div className="space-y-3">
          {normalized.map((item) => (
            <div key={`r-${item.label}`}>
              <div className="mb-1 flex justify-between text-xs text-content-secondary">
                <span>{item.label}</span>
                <span>{item.refPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-line/40 ring-1 ring-inset ring-line/50">
                <div className="h-2 rounded-full bg-amber-500/80" style={{ width: `${item.refPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StripePollingToolbar({
  live,
  onToggleLive,
  lastUpdated,
}: {
  live: boolean;
  onToggleLive: () => void;
  lastUpdated: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" type="button" onClick={onToggleLive}>
        {live ? "Pausar atualização" : "Retomar atualização"}
      </Button>
      {lastUpdated ? (
        <span className="text-xs text-content-faint">
          Última atualização: {lastUpdated}
        </span>
      ) : null}
      <span className="text-[11px] text-content-faint">{live ? `Atualização a cada ${POLL_MS / 1000}s` : ""}</span>
    </div>
  );
}

type PlanFilterVal = "all" | "solo" | "equipa" | "escala";

function useDebouncedStripeParams(from: string, to: string, plan: PlanFilterVal) {
  const [debouncedFrom, setDf] = useState(from);
  const [debouncedTo, setDt] = useState(to);
  const [debouncedPlan, setDp] = useState(plan);
  useEffect(() => {
    const t = setTimeout(() => {
      setDf(from);
      setDt(to);
      setDp(plan);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [from, to, plan]);
  return { debouncedFrom, debouncedTo, debouncedPlan };
}

/** Construtor de query estável para as rotas Stripe admin. */
function buildStripeQuery(d: {
  from: string;
  to: string;
  plan?: PlanFilterVal;
  limit?: number;
  cursor?: string | null;
  invoiceStatus?: string;
}) {
  const p = new URLSearchParams();
  p.set("from", d.from);
  p.set("to", d.to);
  p.set("limit", String(d.limit ?? 25));
  if (d.plan && d.plan !== "all") p.set("plan", d.plan);
  if (d.cursor) p.set("cursor", d.cursor);
  if (d.invoiceStatus && d.invoiceStatus !== "all") p.set("invoiceStatus", d.invoiceStatus);
  return p.toString();
}

export function StripePagamentosPage() {
  const init = defaultDateRangeStrings();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [plan, setPlan] = useState<PlanFilterVal>("all");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminStripePagamentoRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastUpd, setLastUpd] = useState<string | null>(null);

  const { debouncedFrom, debouncedTo, debouncedPlan } = useDebouncedStripeParams(from, to, plan);
  const qBase = useMemo(
    () => buildStripeQuery({ from: debouncedFrom, to: debouncedTo, plan: debouncedPlan, limit: 25 }),
    [debouncedFrom, debouncedTo, debouncedPlan],
  );

  const fetchFresh = useCallback(
    async (append: boolean) => {
      setLoading(true);
      setErr(null);
      try {
        const qp = append && cursor ? `${qBase}&cursor=${encodeURIComponent(cursor)}` : qBase;
        const res = await fetch(`/api/admin/stripe/pagamentos?${qp}`, { credentials: "include", cache: "no-store" });
        const js = await res.json();
        if (!res.ok) {
          setErr(typeof js?.error === "string" ? js.error : "Falha ao carregar pagamentos Stripe.");
          return;
        }
        const nextRows: AdminStripePagamentoRow[] = js.rows ?? [];
        setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
        setCursor(js.nextCursor ?? null);
        setHasMore(Boolean(js.hasMore));
        setLastUpd(new Date().toLocaleString("pt-BR"));
      } catch {
        setErr("Erro de rede ao consultar Stripe.");
      } finally {
        setLoading(false);
      }
    },
    [qBase, cursor],
  );

  useEffect(() => {
    void fetchFresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtros aplicados apenas após debounce
  }, [debouncedFrom, debouncedTo, debouncedPlan]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      void fetchFresh(false);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, fetchFresh]);

  const columns: Column<AdminStripePagamentoRow>[] = [
    {
      key: "created",
      header: "Data",
      render: (r) => new Date(r.created).toLocaleString("pt-BR"),
    },
    { key: "customerLabel", header: "Cliente", render: (r) => r.customerLabel },
    { key: "amountDisplay", header: "Valor", render: (r) => r.amountDisplay },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "outcomeType", header: "Outcome", render: (r) => r.outcomeType ?? "—" },
    { key: "refunded", header: "Reembolso", render: (r) => formatCents(r.currency, r.refundedCents) },
    { key: "disputed", header: "Disputa", render: (r) => (r.disputed ? "sim" : "—") },
    { key: "id", header: "ID", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Eventos de pagamento (Stripe)"
        description="Cobranças no período, consultadas diretamente na API Stripe. Atualização automática opcional."
        actions={<StripePollingToolbar live={live} onToggleLive={() => setLive((v) => !v)} lastUpdated={lastUpd} />}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Data inicial" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Data final" />
          <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanFilterVal)}>
            <option value="all">Todos os planos (checkout)</option>
            <option value="solo">Solo</option>
            <option value="equipa">Equipa</option>
            <option value="escala">Escala</option>
          </Select>
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void fetchFresh(false)}>
            Recarregar agora
          </Button>
        </div>
        {err ? <p className="mb-3 text-sm text-rose-400">{err}</p> : null}
        <p className="mb-3 text-[11px] text-content-faint">
          Este feed lista charges do Stripe. Filtro de plano aplica apenas às páginas de faturas e churn onde há assinatura/price IDs.
        </p>
        {loading && !rows.length ? (
          <div className="h-40 animate-pulse rounded-xl bg-surface-elevated/40" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-content-faint">Nenhuma cobrança encontrada neste período.</p>
        ) : (
          <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
        )}
        {hasMore ? (
          <div className="mt-4">
            <Button variant="secondary" type="button" disabled={loading} onClick={() => void fetchFresh(true)}>
              Carregar mais
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

export function StripeFaturasPage() {
  const init = defaultDateRangeStrings();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [plan, setPlan] = useState<PlanFilterVal>("all");
  const [invStatus, setInvStatus] = useState<string>("all");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminStripeFaturaRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastUpd, setLastUpd] = useState<string | null>(null);

  const { debouncedFrom, debouncedTo, debouncedPlan } = useDebouncedStripeParams(from, to, plan);
  const baseQuery = useMemo(
    () =>
      buildStripeQuery({
        from: debouncedFrom,
        to: debouncedTo,
        plan: debouncedPlan,
        limit: 25,
        invoiceStatus: invStatus,
      }),
    [debouncedFrom, debouncedTo, debouncedPlan, invStatus],
  );

  const fetchFresh = useCallback(
    async (append: boolean) => {
      setLoading(true);
      setErr(null);
      try {
        const qp =
          append && cursor ? `${baseQuery}&cursor=${encodeURIComponent(cursor)}` : baseQuery;
        const res = await fetch(`/api/admin/stripe/faturas?${qp}`, { credentials: "include", cache: "no-store" });
        const js = await res.json();
        if (!res.ok) {
          setErr(typeof js?.error === "string" ? js.error : "Falha ao carregar faturas Stripe.");
          return;
        }
        const nextRows: AdminStripeFaturaRow[] = js.rows ?? [];
        setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
        setCursor(js.nextCursor ?? null);
        setHasMore(Boolean(js.hasMore));
        setLastUpd(new Date().toLocaleString("pt-BR"));
      } catch {
        setErr("Erro de rede ao consultar Stripe.");
      } finally {
        setLoading(false);
      }
    },
    [baseQuery, cursor],
  );

  useEffect(() => {
    void fetchFresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFrom, debouncedTo, debouncedPlan, invStatus]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void fetchFresh(false), POLL_MS);
    return () => window.clearInterval(id);
  }, [live, fetchFresh]);

  const columns: Column<AdminStripeFaturaRow>[] = [
    { key: "created", header: "Data", render: (r) => new Date(r.created).toLocaleString("pt-BR") },
    { key: "customerLabel", header: "Cliente", render: (r) => r.customerLabel },
    { key: "status", header: "Status", render: (r) => r.status ?? "—" },
    { key: "amountDue", header: "Em aberto", render: (r) => r.amountDueDisplay },
    {
      key: "paid",
      header: "Pago",
      render: (r) => formatCents(r.currency, r.amountPaidCents),
    },
    {
      key: "link",
      header: "Link",
      render: (r) =>
        r.hostedInvoiceUrl ? (
          <a className="text-primary underline underline-offset-2" href={r.hostedInvoiceUrl} target="_blank" rel="noreferrer">
            Abrir no Stripe
          </a>
        ) : (
          "—"
        ),
    },
    { key: "id", header: "ID", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Faturas Stripe"
        description="Invoices criadas/atualizadas no período."
        actions={<StripePollingToolbar live={live} onToggleLive={() => setLive((v) => !v)} lastUpdated={lastUpd} />}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanFilterVal)}>
            <option value="all">Todos os planos</option>
            <option value="solo">Solo</option>
            <option value="equipa">Equipa</option>
            <option value="escala">Escala</option>
          </Select>
          <Select value={invStatus} onChange={(e) => setInvStatus(e.target.value)}>
            <option value="all">Todos os status Stripe</option>
            <option value="draft">draft</option>
            <option value="open">open</option>
            <option value="paid">paid</option>
            <option value="void">void</option>
            <option value="uncollectible">uncollectible</option>
          </Select>
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void fetchFresh(false)}>
            Recarregar
          </Button>
        </div>
        {err ? <p className="mb-3 text-sm text-rose-400">{err}</p> : null}
        {loading && !rows.length ? (
          <div className="h-40 animate-pulse rounded-xl bg-surface-elevated/40" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-content-faint">Nenhuma fatura no período.</p>
        ) : (
          <DataTable columns={columns} data={rows} rowKey={(r) => String(r.id)} />
        )}
        {hasMore ? (
          <div className="mt-4">
            <Button variant="secondary" type="button" disabled={loading} onClick={() => void fetchFresh(true)}>
              Carregar mais
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

export function StripeFinanceiroPage() {
  const init = defaultDateRangeStrings();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AdminStripeFinanceiroPayload | null>(null);
  const [lastUpd, setLastUpd] = useState<string | null>(null);

  const { debouncedFrom, debouncedTo, debouncedPlan: _p } = useDebouncedStripeParams(from, to, "all");
  void _p;

  const qBase = useMemo(
    () => buildStripeQuery({ from: debouncedFrom, to: debouncedTo, limit: 1 }),
    [debouncedFrom, debouncedTo],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/stripe/financeiro?${qBase}`, { credentials: "include", cache: "no-store" });
      const js = await res.json();
      if (!res.ok) {
        setErr(typeof js?.error === "string" ? js.error : "Falha ao consolidar Stripe.");
        return;
      }
      setData(js as AdminStripeFinanceiroPayload);
      setLastUpd(new Date().toLocaleString("pt-BR"));
    } catch {
      setErr("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [qBase]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFrom, debouncedTo]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, load]);

  const kpis = data?.kpis;

  return (
    <div className="space-y-6">
      <Panel
        title="Painel financeiro (Stripe)"
        description="Consolida charges, intents com erro, contagem de invoices e churn de assinaturas no período. Agregações limitadas às páginas de charges retornadas (até ~2000) — suficiente para operação típica; volumes muito grandes exigiriam webhooks persistentes."
        actions={<StripePollingToolbar live={live} onToggleLive={() => setLive((v) => !v)} lastUpdated={lastUpd} />}
      >
        <div className="mb-4 flex flex-wrap gap-3 md:grid md:grid-cols-4">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void load()} className="md:col-span-2">
            Recarregar agora
          </Button>
        </div>
        {err ? <p className="mb-3 text-sm text-rose-400">{err}</p> : null}
        {loading && !data ? <div className="h-48 animate-pulse rounded-xl bg-surface-elevated/40" /> : null}
        {kpis ? (
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stat label="Bruto cobrado" value={formatCents(kpis.currency, kpis.grossChargesCents)} helper="Charges pagos no período" />
              <Stat label="Reembolsos" value={formatCents(kpis.currency, kpis.totalRefundedCents)} helper="Somado em amount_refunded" />
              <Stat label="Liquído estimado" value={formatCents(kpis.currency, kpis.netChargesCents)} helper="Bruto menos reembolsos totais" />
              <Stat label="Charges pagos (#)" value={String(kpis.succeededChargeCount)} helper={`Intents com erro: ${kpis.failedPaymentIntentCount}`} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stat label="Faturas pagas" value={String(kpis.invoicesPaidCount)} helper="Stripe Invoices paid" />
              <Stat label="Faturas abertas" value={String(kpis.invoicesOpenCount)} helper="Ainda não liquidadas" />
              <Stat label="Incolectáveis" value={String(kpis.invoicesUncollectibleCount)} helper="Stripe uncollectible" />
              <Stat label="Disputas (charges)" value={String(kpis.openOrLostDisputeCharges)} helper="Flag disputed no período analisado" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Assinaturas canceladas"
                value={String(kpis.canceledSubscriptionsInRange)}
                helper="Canceladas dentro do período"
              />
              <Stat
                label="MRR perdido estimado"
                value={formatCents(kpis.currency, kpis.estimatedMonthlyRecurringCanceledCents)}
                helper="Somado sobre itens das subs canceladas"
              />
              <Stat label="Moeda KPI" value={kpis.currency.toUpperCase()} helper="Principais valores na moeda Stripe" />
            </div>
            {data.seriesDaily?.length ? <FinanceBars series={data.seriesDaily} /> : null}
          </div>
        ) : !loading ? (
          <p className="text-sm text-content-faint">Sem dados.</p>
        ) : null}
      </Panel>
    </div>
  );
}

export function StripeChurnPage() {
  const init = defaultDateRangeStrings();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [plan, setPlan] = useState<PlanFilterVal>("all");
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminStripeChurnRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [lastUpd, setLastUpd] = useState<string | null>(null);

  const { debouncedFrom, debouncedTo, debouncedPlan } = useDebouncedStripeParams(from, to, plan);
  const qBase = useMemo(
    () => buildStripeQuery({ from: debouncedFrom, to: debouncedTo, plan: debouncedPlan, limit: 30 }),
    [debouncedFrom, debouncedTo, debouncedPlan],
  );

  const fetchFresh = useCallback(
    async (append: boolean) => {
      setLoading(true);
      setErr(null);
      try {
        const qp =
          append && cursor ? `${qBase}&cursor=${encodeURIComponent(cursor)}` : qBase;
        const res = await fetch(`/api/admin/stripe/churn?${qp}`, { credentials: "include", cache: "no-store" });
        const js = await res.json();
        if (!res.ok) {
          setErr(typeof js?.error === "string" ? js.error : "Falha ao carregar churn.");
          return;
        }
        const nextRows: AdminStripeChurnRow[] = js.rows ?? [];
        setRows((prev) => (append ? [...prev, ...nextRows] : nextRows));
        setCursor(js.nextCursor ?? null);
        setHasMore(Boolean(js.hasMore));
        setLastUpd(new Date().toLocaleString("pt-BR"));
      } catch {
        setErr("Erro de rede.");
      } finally {
        setLoading(false);
      }
    },
    [qBase, cursor],
  );

  useEffect(() => {
    void fetchFresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFrom, debouncedTo, debouncedPlan]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => void fetchFresh(false), POLL_MS);
    return () => window.clearInterval(id);
  }, [live, fetchFresh]);

  const columns: Column<AdminStripeChurnRow>[] = [
    { key: "canceledAt", header: "Cancelado em", render: (r) => (r.canceledAt ? new Date(r.canceledAt).toLocaleString("pt-BR") : "—") },
    { key: "customerLabel", header: "Cliente", render: (r) => r.customerLabel },
    {
      key: "mrr",
      header: "MRR perdido estimado",
      render: (r) => (r.estimatedMonthlyCents != null ? formatCents(r.currency, r.estimatedMonthlyCents) : "—"),
    },
    { key: "sub", header: "Assinatura", render: (r) => <span className="font-mono text-xs">{r.subscriptionId}</span> },
  ];

  return (
    <div className="space-y-6">
      <Panel
        title="Churn Stripe"
        description="Assinaturas Stripe canceladas dentro do período informado."
        actions={<StripePollingToolbar live={live} onToggleLive={() => setLive((v) => !v)} lastUpdated={lastUpd} />}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanFilterVal)}>
            <option value="all">Todos os planos</option>
            <option value="solo">Solo</option>
            <option value="equipa">Equipa</option>
            <option value="escala">Escala</option>
          </Select>
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void fetchFresh(false)}>
            Recarregar
          </Button>
        </div>
        {err ? <p className="mb-3 text-sm text-rose-400">{err}</p> : null}
        {loading && !rows.length ? (
          <div className="h-40 animate-pulse rounded-xl bg-surface-elevated/40" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-content-faint">Nenhuma assinatura cancelada neste período.</p>
        ) : (
          <DataTable columns={columns} data={rows} rowKey={(r) => r.subscriptionId} />
        )}
        {hasMore ? (
          <div className="mt-4">
            <Button variant="secondary" type="button" disabled={loading} onClick={() => void fetchFresh(true)}>
              Carregar mais
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
