"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Filter, Loader2 } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { useCrmFunnels } from "@/components/dashboard/CrmFunnelsContext";
import type { TeamEmployee } from "@/lib/team-employees-types";
import { cn } from "@/lib/utils";

type AccessMap = Record<string, string[]>;

/**
 * Liberação de funis por colaborador — só o titular.
 *
 * Liberar funis **restringe**: o colaborador continua vendo apenas os leads sob
 * a responsabilidade dele, e passa a vê-los só nos funis marcados. Nenhum funil
 * marcado = sem restrição (todos os leads dele, em qualquer funil).
 */
export function FunnelAccessPanel({ employees }: { employees: TeamEmployee[] }) {
  const { funnels } = useCrmFunnels();
  const [access, setAccess] = useState<AccessMap>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // O titular não se restringe: ele enxerga tudo por definição.
  const restrictable = useMemo(
    () => employees.filter((employee) => !employee.isOwner && employee.ativo),
    [employees],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/client/crm/funnel-access", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("load_failed");
      const data = (await res.json()) as { access?: AccessMap };
      setAccess(data.access ?? {});
      setError(null);
    } catch {
      setError("Não foi possível carregar as liberações de funil.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (employeeId: string, next: string[]) => {
    if (savingId) return;
    const previous = access;
    setAccess({ ...access, [employeeId]: next });
    setSavingId(employeeId);
    setError(null);
    try {
      const res = await fetch("/api/client/crm/funnel-access", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, funnelIds: next }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? "save_failed");
      }
      const data = (await res.json()) as { access?: AccessMap };
      if (data.access) setAccess(data.access);
    } catch (err) {
      setAccess(previous);
      setError(err instanceof Error && err.message !== "save_failed"
        ? err.message
        : "Não foi possível salvar a liberação.");
    } finally {
      setSavingId(null);
    }
  };

  const toggle = (employeeId: string, funnelId: string) => {
    const current = access[employeeId] ?? [];
    return save(
      employeeId,
      current.includes(funnelId)
        ? current.filter((id) => id !== funnelId)
        : [...current, funnelId],
    );
  };

  if (!restrictable.length) return null;

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Filter size={18} strokeWidth={1.9} className="mt-0.5 shrink-0 text-content-muted" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight text-content">
            Acesso aos funis do CRM
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-content-muted">
            Marque em quais funis cada colaborador trabalha. Ele continua vendo apenas os leads sob
            a responsabilidade dele — a liberação só limita <strong>em quais funis</strong> esses
            leads aparecem. <strong>Nenhum funil marcado</strong> significa sem restrição.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[12.5px] text-error">
          <AlertCircle size={14} strokeWidth={2} />
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-content-muted">
          <Loader2 size={14} className="animate-spin" />
          Carregando…
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {restrictable.map((employee) => {
            const granted = access[employee.id] ?? [];
            return (
              <div key={employee.id} className="rounded-lg border border-line/70 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-content">{employee.nome}</p>
                    <p className="text-[11.5px] text-content-muted">
                      {granted.length === 0
                        ? "Sem restrição — vê os leads dele em qualquer funil"
                        : `Restrito a ${granted.length} funil${granted.length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  {savingId === employee.id && (
                    <Loader2 size={14} className="animate-spin text-content-muted" />
                  )}
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  {funnels.map((funnel) => {
                    const checked = granted.includes(funnel.id);
                    return (
                      <button
                        key={funnel.id}
                        type="button"
                        disabled={savingId !== null}
                        onClick={() => void toggle(employee.id, funnel.id)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-50",
                          checked
                            ? "border-primary/45 bg-primary/10 text-primary"
                            : "border-line text-content-secondary hover:border-primary/30",
                        )}
                      >
                        {funnel.nome}
                      </button>
                    );
                  })}
                </div>

                {granted.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    disabled={savingId !== null}
                    onClick={() => void save(employee.id, [])}
                  >
                    Remover restrição
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
