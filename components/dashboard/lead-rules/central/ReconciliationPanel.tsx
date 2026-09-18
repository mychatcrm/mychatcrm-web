"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, DownloadCloud, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/lib/client-auth";
import { DEFAULT_CENTRAL_TIMEZONE, resolveDatePreset } from "@/lib/meta-leads/central-filters";

type RunRow = {
  id: string;
  period_from: string;
  period_to: string;
  status: "running" | "completed" | "failed" | "partial";
  pages_checked: number;
  forms_checked: number;
  meta_total: number;
  local_total: number;
  missing_total: number;
  imported_total: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

type GapRow = {
  id: string;
  form_name: string | null;
  form_id: string | null;
  leadgen_id: string;
  lead_created_time: string | null;
  status: "missing" | "imported" | "import_failed" | "skipped";
  import_error: string | null;
};

function formatDay(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/**
 * Reconciliação Meta ↔ MyChatCRM.
 *
 * Responde a pergunta que nenhum painel do mercado responde: **o que a Meta
 * entregou e não chegou aqui?** Conexão que expirou, formulário fora das
 * regras, webhook perdido — hoje o cliente só percebe que "entrou menos lead" e
 * não tem como provar nem recuperar. Aqui ele vê o número e importa o que
 * faltou, sem disparar mensagem para lead antigo.
 */
export function ReconciliationPanel({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();
  const [run, setRun] = useState<RunRow | null>(null);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [withOutreach, setWithOutreach] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const defaultPeriod = useMemo(() => resolveDatePreset("30d", DEFAULT_CENTRAL_TIMEZONE), []);
  const [from, setFrom] = useState(defaultPeriod.from);
  const [to, setTo] = useState(defaultPeriod.to);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/client/meta/reconciliation", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const json = (await response.json()) as { run?: RunRow | null; gaps?: GapRow[]; allowed?: boolean };
      setRun(json.run ?? null);
      setGaps(json.gaps ?? []);
      setAllowed(json.allowed !== false);
    } catch {
      /* silencioso: o bloco é informativo, não bloqueia a Central */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, session.tenantId]);

  const runReconciliation = useCallback(async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/client/meta/reconciliation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, timezone: DEFAULT_CENTRAL_TIMEZONE }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        run?: RunRow;
        gaps?: GapRow[];
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "Não foi possível comparar com a Meta.");
      setRun(json.run ?? null);
      setGaps(json.gaps ?? []);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na reconciliação.");
    } finally {
      setRunning(false);
    }
  }, [from, to]);

  const importMissing = useCallback(async () => {
    if (!run) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/client/meta/reconciliation/backfill", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, withOutreach }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        imported?: number;
        failed?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(json.error ?? "Não foi possível importar.");
      setNotice(
        `${json.imported ?? 0} lead(s) importado(s)${json.failed ? `, ${json.failed} com falha` : ""}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao importar.");
    } finally {
      setImporting(false);
    }
  }, [run, withOutreach, load]);

  if (!allowed) return null;

  const missing = run?.missing_total ?? 0;
  const pendingGaps = gaps.filter((gap) => gap.status === "missing");

  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border p-4 sm:p-5",
        missing > 0
          ? "border-amber-500/50 bg-amber-500/[0.06]"
          : isLight
            ? "border-slate-200/80 bg-surface-deep"
            : "border-line/80 bg-surface-card/80",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-bold tracking-tight text-content">
            {missing > 0 ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            )}
            Conferência com a Meta
          </h2>
          <p className="mt-1 text-[13px] text-content-muted">
            {run
              ? run.status === "failed"
                ? `Última tentativa falhou: ${run.error_message ?? "erro desconhecido"}`
                : missing > 0
                  ? `A Meta registou ${run.meta_total.toLocaleString("pt-BR")} leads entre ${formatDay(run.period_from)} e ${formatDay(run.period_to)}. ${missing.toLocaleString("pt-BR")} não chegaram aqui.`
                  : `Tudo certo: os ${run.meta_total.toLocaleString("pt-BR")} leads do período entre ${formatDay(run.period_from)} e ${formatDay(run.period_to)} estão na sua base.`
              : "Compare o que a Meta registou nos seus formulários com o que chegou ao MyChatCRM — e recupere o que faltou."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-content-muted">
            De
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-8 rounded-lg border border-line bg-surface-card px-2 text-xs text-content outline-none focus:border-primary/60"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-content-muted">
            Até
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-8 rounded-lg border border-line bg-surface-card px-2 text-xs text-content outline-none focus:border-primary/60"
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => void runReconciliation()} disabled={running || loading}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCcw className="h-3.5 w-3.5" aria-hidden />}
            Conferir agora
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          {notice}
        </p>
      ) : null}

      {run && missing > 0 ? (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Na Meta", value: run.meta_total },
              { label: "Na sua base", value: run.local_total },
              { label: "Faltando", value: run.missing_total },
              { label: "Já importados", value: run.imported_total },
            ].map((stat) => (
              <div
                key={stat.label}
                className={cn(
                  "rounded-lg border px-3 py-2",
                  isLight ? "border-slate-200 bg-white" : "border-line/70 bg-surface-deep/50",
                )}
              >
                <p className="text-[10px] uppercase tracking-wide text-content-muted">{stat.label}</p>
                <p className="text-lg font-bold tabular-nums text-content">
                  {stat.value.toLocaleString("pt-BR")}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-content-secondary">
              <input
                type="checkbox"
                checked={withOutreach}
                onChange={(event) => setWithOutreach(event.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Também acionar o agente nestes leads
              <span className="text-content-faint">(por padrão entram só no CRM)</span>
            </label>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void importMissing()}
              disabled={importing || pendingGaps.length === 0}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <DownloadCloud className="h-3.5 w-3.5" aria-hidden />}
              Importar {pendingGaps.length.toLocaleString("pt-BR")} lead(s)
            </Button>
          </div>

          {withOutreach ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
              Atenção: com esta opção o agente inicia conversa com cada lead importado, mesmo os mais antigos.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {expanded ? "Ocultar" : "Ver"} os leads que faltam
          </button>

          {expanded ? (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line/60">
              <table className="min-w-full text-left text-xs">
                <thead className={cn(isLight ? "bg-slate-50" : "bg-surface-elevated/40")}>
                  <tr>
                    {["Recebido na Meta", "Formulário", "Leadgen ID", "Situação"].map((header) => (
                      <th key={header} className="px-3 py-2 text-[10px] uppercase tracking-wide text-content-muted">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {gaps.slice(0, 200).map((gap) => (
                    <tr key={gap.id}>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-content-muted">
                        {gap.lead_created_time
                          ? new Date(gap.lead_created_time).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-1.5 text-content-secondary">
                        {gap.form_name || gap.form_id || "—"}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-content-faint">{gap.leadgen_id}</td>
                      <td className="px-3 py-1.5 text-content-secondary">
                        {gap.status === "imported"
                          ? "Importado"
                          : gap.status === "import_failed"
                            ? (gap.import_error ?? "Falhou")
                            : "Faltando"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
