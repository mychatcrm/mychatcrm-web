"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ClientPlan } from "@/lib/client-auth";
import type { PlanLimits } from "@/lib/plan-policy";
import {
  CRM_FUNNELS_STORAGE_KEY,
  getCrmFunnelsSnapshot,
  migrateFunnelColumns,
  newCrmFunnelId,
  newFunnelColumnId,
  persistCrmFunnels,
  resetCrmFunnelsToSafeDefaults,
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
  resetToSafeDefaults: () => void;
};

const CrmFunnelsContext = createContext<CrmFunnelsContextValue | null>(null);

export function CrmFunnelsProvider({
  children,
  clientPlan,
  operationalLimits,
  isOwner,
}: {
  children: ReactNode;
  /** Plano da sessão do painel — define o teto de funis comerciais. */
  clientPlan: ClientPlan;
  /** Enterprise: limites resolvidos no login (cookie assinado). */
  operationalLimits?: PlanLimits | null;
  /**
   * Só o titular pode alterar os funis do tenant (a API já recusa com 403).
   * Aqui é defesa em profundidade: um colaborador com liberação parcial só
   * recebe o subconjunto liberado do servidor — se o cliente publicasse esse
   * subconjunto de volta, sobrescreveria a lista completa do tenant. Sem
   * `isOwner`, o contexto nunca tenta publicar, só lê.
   */
  isOwner: boolean;
}) {
  const [funnels, setFunnels] = useState<CrmFunnel[]>(() => getCrmFunnelsSnapshot());
  // Enquanto o servidor não respondeu, o localStorage segue valendo para a UI
  // não piscar — mas nada é enviado de volta, senão um cache velho de outra
  // máquina sobrescreveria a configuração real do tenant.
  const [hydrated, setHydrated] = useState(false);
  const lastSyncedRef = useRef<string | null>(null);

  const maxFunnels = useMemo(
    () => getPlanMaxSalesFunnels(normalizeClientPlan(clientPlan), operationalLimits),
    [clientPlan, operationalLimits],
  );

  const adopt = useCallback((next: CrmFunnel[]) => {
    lastSyncedRef.current = JSON.stringify(next);
    persistCrmFunnels(next);
    setFunnels(next);
  }, []);

  /**
   * Carrega do servidor — fonte de verdade desde 04/08/2026. Se o tenant ainda
   * não tem nenhum funil lá, sobe os que existiam no navegador (o servidor só
   * aceita esse seed do titular e só enquanto a lista estiver vazia).
   */
  const loadFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/client/crm/funnels", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { funnels?: CrmFunnel[] };
      const remote = Array.isArray(data.funnels) ? data.funnels : [];

      if (remote.length > 0) {
        adopt(remote);
        return;
      }

      // Colaborador não-titular nunca semeia: a API recusaria (só o titular
      // escreve) e ele só recebe do servidor o subconjunto liberado — subir o
      // que sobrou no navegador dele não corresponderia à configuração real
      // do tenant.
      if (!isOwner) return;

      const local = getCrmFunnelsSnapshot();
      const seed = await fetch("/api/client/crm/funnels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnels: local, seedOnly: true }),
      });
      if (!seed.ok) return;
      const seeded = (await seed.json()) as { funnels?: CrmFunnel[] };
      if (Array.isArray(seeded.funnels) && seeded.funnels.length) adopt(seeded.funnels);
    } catch {
      // Offline ou rede instável: segue com o cache local até a próxima carga.
    } finally {
      setHydrated(true);
    }
  }, [adopt, isOwner]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  // Publica no servidor toda alteração feita depois da hidratação. Só o
  // titular: um colaborador restrito só tem o subconjunto liberado em
  // memória, e publicar isso sobrescreveria a lista completa do tenant.
  useEffect(() => {
    if (!hydrated || !isOwner) return;
    const serialized = JSON.stringify(funnels);
    if (serialized === lastSyncedRef.current) return;
    lastSyncedRef.current = serialized;

    void (async () => {
      try {
        const res = await fetch("/api/client/crm/funnels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ funnels }),
        });
        // 403 (não é titular) ou limite de plano: o servidor recusou, então a
        // tela precisa voltar ao que vale de verdade em vez de mostrar uma
        // alteração que não foi salva.
        if (!res.ok) await loadFromServer();
      } catch {
        // Rede caiu: o localStorage segura até a próxima carga.
      }
    })();
  }, [funnels, hydrated, isOwner, loadFromServer]);

  const reload = useCallback(() => {
    void loadFromServer();
  }, [loadFromServer]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CRM_FUNNELS_STORAGE_KEY) setFunnels(getCrmFunnelsSnapshot());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
      const next = prev.map((f) => {
        if (f.id !== funnelId) return f;
        const columns = patch.columns ? migrateFunnelColumns(patch.columns) : migrateFunnelColumns(f.columns);
        return { ...f, ...patch, columns };
      });
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

  const resetToSafeDefaults = useCallback(() => {
    const next = resetCrmFunnelsToSafeDefaults();
    setFunnels(next);
  }, []);

  const value = useMemo(
    () => ({
      funnels,
      addFunnel,
      updateFunnel,
      deleteFunnel,
      appendFunnelColumn,
      removeFunnelColumn,
      reload,
      resetToSafeDefaults,
    }),
    [funnels, addFunnel, updateFunnel, deleteFunnel, appendFunnelColumn, removeFunnelColumn, reload, resetToSafeDefaults],
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
