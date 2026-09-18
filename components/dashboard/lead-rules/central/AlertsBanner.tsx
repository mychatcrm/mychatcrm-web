"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, X } from "lucide-react";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";

type Alert = {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  detectedAt: string;
};

/**
 * Avisos de campanha no topo da Central.
 *
 * O problema que isto resolve é de tempo: hoje o cliente descobre que um
 * formulário parou quando estranha o silêncio, às vezes dias depois. O aviso
 * compara a janela recente com a anterior de mesmo tamanho, então serve tanto a
 * quem recebe 50 leads por mês quanto a quem recebe 15 mil.
 */
export function AlertsBanner() {
  const { isLight } = usePanelAppearance();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/client/meta/lead-alerts?detect=1", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const json = (await response.json()) as { alerts?: Alert[] };
      setAlerts(json.alerts ?? []);
    } catch {
      /* aviso é complemento: nunca bloqueia a Central */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = useCallback(async (alertId: string) => {
    setAlerts((current) => current.filter((alert) => alert.id !== alertId));
    try {
      await fetch("/api/client/meta/lead-alerts", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
    } catch {
      /* o aviso volta no próximo carregamento se não deu para marcar */
    }
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const critical = alert.severity === "critical";
        return (
          <div
            key={alert.id}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3",
              critical
                ? "border-red-500/50 bg-red-500/[0.07]"
                : "border-amber-500/50 bg-amber-500/[0.07]",
            )}
          >
            {critical ? (
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-content">{alert.title}</p>
              <p className={cn("mt-0.5 text-xs", isLight ? "text-slate-600" : "text-content-muted")}>
                {alert.detail}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void dismiss(alert.id)}
              aria-label="Marcar como visto"
              className="shrink-0 rounded p-1 text-content-muted transition-colors hover:text-content"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
