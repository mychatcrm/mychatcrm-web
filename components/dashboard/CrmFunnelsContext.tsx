"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import {
  CRM_FUNNELS_STORAGE_KEY,
  getCrmFunnelsSnapshot,
  newCrmFunnelId,
  newFunnelColumnId,
  persistCrmFunnels,
  templateColumnsFromGlobalKanban,
  type CrmFunnel,
} from "@/lib/crm-funnels";
import { getPlanMaxSalesFunnels, normalizeClientPlan } from "@/lib/plan-limits";

type CrmFunnelsContextValue = {
  funnels: CrmFunnel[];
  addFunnel: (nome: string) => CrmFunnel | null;
  updateFunnel: (funnelId: string, patch: Partial<Pick<CrmFunnel, "nome" | "columns">>) => void;
  deleteFunnel: (funnelId: string) => void;
  appendFunnelColumn: (funnelId: string) => void;
  removeFunnelColumn: (funnelId: string, columnId: string) => void;
  reload: () => void;
};

const CrmFunnelsContext = createContext<CrmFunnelsContextValue | null>(null);

export function CrmFunnelsProvider({
  children,
  clientPlan,
  operationalLimits,
}: {
  children: ReactNode;
  /** Plano da sessão do painel — define o teto de funis comerciais. */
  clientPlan: ClientPlan;
  /** Enterprise: limites resolvidos no login (cookie assinado). */
  operationalLimits?: PlanLimits | null;
}) {
  const [funnels, setFunnels] = useState<CrmFunnel[]>(() => getCrmFunnelsSnapshot());

  const maxFunnels = useMemo(
    () => getPlanMaxSalesFunnels(normalizeClientPlan(clientPlan), operationalLimits),
    [clientPlan, operationalLimits],
  );

  const reload = useCallback(() => {
    setFunnels(getCrmFunnelsSnapshot());
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CRM_FUNNELS_STORAGE_KEY) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);

  const addFunnel = useCallback(
    (nome: string) => {
      const trimmed = nome.trim();
      if (!trimmed) return null;
      const created: CrmFunnel = {
        id: newCrmFunnelId(),
        nome: trimmed,
        columns: templateColumnsFromGlobalKanban().map((c) => ({ ...c })),
      };
      let allowed = false;
      setFunnels((prev) => {
        if (prev.length >= maxFunnels) {
          return prev;
        }
        allowed = true;
        const next = [...prev, created];
        persistCrmFunnels(next);
        return next;
      });
      return allowed ? created : null;
    },
    [maxFunnels],
  );

  const updateFunnel = useCallback((funnelId: string, patch: Partial<Pick<CrmFunnel, "nome" | "columns">>) => {
    setFunnels((prev) => {
      const next = prev.map((f) => (f.id === funnelId ? { ...f, ...patch, columns: patch.columns ?? f.columns } : f));
      persistCrmFunnels(next);
      return next;
    });
  }, []);

  const deleteFunnel = useCallback((funnelId: string) => {
    setFunnels((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((f) => f.id !== funnelId);
      persistCrmFunnels(next);
      return next;
    });
  }, []);

  const appendFunnelColumn = useCallback((funnelId: string) => {
    setFunnels((prev) => {
      const next = prev.map((f) =>
        f.id === funnelId
          ? { ...f, columns: [...f.columns.map((c) => ({ ...c })), { id: newFunnelColumnId(), title: "Nova etapa" }] }
          : f,
      );
      persistCrmFunnels(next);
      return next;
    });
  }, []);

  const removeFunnelColumn = useCallback((funnelId: string, columnId: string) => {
    setFunnels((prev) => {
      const next = prev.map((f) => {
        if (f.id !== funnelId) return f;
        if (f.columns.length <= 2) return f;
        if (!f.columns.some((c) => c.id === columnId)) return f;
        return { ...f, columns: f.columns.filter((c) => c.id !== columnId) };
      });
      persistCrmFunnels(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ funnels, addFunnel, updateFunnel, deleteFunnel, appendFunnelColumn, removeFunnelColumn, reload }),
    [funnels, addFunnel, updateFunnel, deleteFunnel, appendFunnelColumn, removeFunnelColumn, reload],
  );

  return <CrmFunnelsContext.Provider value={value}>{children}</CrmFunnelsContext.Provider>;
}

export function useCrmFunnels(): CrmFunnelsContextValue {
  const ctx = useContext(CrmFunnelsContext);
  if (!ctx) {
    throw new Error("useCrmFunnels deve ser usado dentro de CrmFunnelsProvider (ex.: DashboardShell).");
  }
  return ctx;
}
