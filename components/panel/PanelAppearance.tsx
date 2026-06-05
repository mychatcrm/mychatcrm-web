"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Circle, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  applyPanelChromeTheme,
  PANEL_APPEARANCE_STORAGE_KEY,
  persistPanelThemeCookie,
} from "@/lib/panel-theme-boot-script";

const STORAGE_KEY = PANEL_APPEARANCE_STORAGE_KEY;

export type PanelKind = "dashboard" | "admin";
export type PanelAppearanceMode = "light" | "soft-dark" | "dark";

type PanelAppearanceContextValue = {
  panel: PanelKind;
  mode: PanelAppearanceMode;
  setMode: (mode: PanelAppearanceMode) => void;
  isLight: boolean;
};

const PanelAppearanceContext = createContext<PanelAppearanceContextValue | null>(null);

/** Valor estável quando não há provider (evita crash em portal/hidratação; tema não persiste até o provider existir). */
const PANEL_APPEARANCE_FALLBACK: PanelAppearanceContextValue = {
  panel: "dashboard",
  mode: "dark",
  setMode: () => {},
  isLight: false,
};

function isPanelAppearanceMode(value: unknown): value is PanelAppearanceMode {
  return value === "light" || value === "soft-dark" || value === "dark";
}

export function getNextPanelAppearanceMode(mode: PanelAppearanceMode): PanelAppearanceMode {
  if (mode === "light") return "soft-dark";
  if (mode === "soft-dark") return "dark";
  return "light";
}

function getPanelAppearanceLabel(mode: PanelAppearanceMode): string {
  if (mode === "light") return "claro";
  if (mode === "soft-dark") return "cinza escuro";
  return "escuro";
}

/**
 * Conteúdo em `createPortal(..., document.body)` deixa de estar no DOM sob `.panel-app`,
 * por isso as variáveis CSS do tema não herdavam — isto repõe contexto React e o wrapper
 * `.panel-app` com os mesmos data-attributes para o CSS do painel aplicar dentro do portal.
 */
export function PanelAppearancePortalBridge({ children }: { children: ReactNode }) {
  const value = useContext(PanelAppearanceContext);
  if (!value) return <>{children}</>;
  return (
    <PanelAppearanceContext.Provider value={value}>
      <div
        className="panel-app panel-app--portal-root flex min-h-0 min-w-0 flex-1 flex-col text-content"
        data-panel={value.panel}
        data-panel-theme={value.mode}
      >
        {children}
      </div>
    </PanelAppearanceContext.Provider>
  );
}

export function usePanelAppearance(): PanelAppearanceContextValue {
  const ctx = useContext(PanelAppearanceContext);
  return ctx ?? PANEL_APPEARANCE_FALLBACK;
}

export function PanelAppearanceProvider({
  panel,
  className,
  children,
  /** Definido no servidor a partir do cookie — primeiro paint já com o tema certo. */
  initialMode,
}: {
  panel: PanelKind;
  className?: string;
  children: ReactNode;
  initialMode?: PanelAppearanceMode;
}) {
  const [mode, setModeState] = useState<PanelAppearanceMode>(() =>
    isPanelAppearanceMode(initialMode) ? initialMode : "dark",
  );

  /**
   * Em cada remontagem (navegação), o SSR envia `initialMode` via cookie. Se o cookie ficar
   * desatualizado face ao `localStorage` (última escolha explícita no browser), preferimos o LS
   * e realinhamos cookie + chrome — evita saltar de tema ao mudar de rota.
   */
  useLayoutEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const ls: PanelAppearanceMode | null = isPanelAppearanceMode(raw) ? raw : null;
      const hinted: PanelAppearanceMode | null = isPanelAppearanceMode(initialMode) ? initialMode : null;
      const resolved: PanelAppearanceMode = ls ?? hinted ?? "dark";

      setModeState((prev) => (prev === resolved ? prev : resolved));
      persistPanelThemeCookie(resolved);
      applyPanelChromeTheme(resolved);
    } catch {
      applyPanelChromeTheme("dark");
    }
  }, [initialMode]);

  const setMode = useCallback((next: PanelAppearanceMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      persistPanelThemeCookie(next);
      applyPanelChromeTheme(next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      panel,
      mode,
      setMode,
      isLight: mode === "light",
    }),
    [panel, mode, setMode],
  );

  return (
    <PanelAppearanceContext.Provider value={value}>
      <div
        className={cn("panel-app min-h-0 text-content", className)}
        data-panel={panel}
        data-panel-theme={mode}
      >
        {children}
      </div>
    </PanelAppearanceContext.Provider>
  );
}

/**
 * Tema — ícone único (DS `PanelButton` ghost): sol em escuro → claro; lua em claro → escuro.
 * Visual discreto: sem borda/chip; só cor muted + hover suave.
 */
export function PanelThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = usePanelAppearance();
  const nextMode = getNextPanelAppearanceMode(mode);
  const currentLabel = getPanelAppearanceLabel(mode);
  const nextLabel = getPanelAppearanceLabel(nextMode);

  return (
    <button
      type="button"
      onClick={() => setMode(nextMode)}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-panel-xl",
        "text-content-faint hover:bg-surface-elevated/40 hover:text-content-secondary",
        "active:bg-surface-elevated/55 active:scale-[0.98]",
        "transition duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sidebar",
        className,
      )}
      aria-label={`Tema atual: ${currentLabel}. Ativar tema ${nextLabel}`}
      title={`Tema atual: ${currentLabel}. Ativar tema ${nextLabel}`}
    >
      {mode === "light" ? (
        <Moon className="h-4 w-4" strokeWidth={2} aria-hidden />
      ) : mode === "soft-dark" ? (
        <Circle className="h-3.5 w-3.5 fill-current" strokeWidth={2} aria-hidden />
      ) : (
        <Sun className="h-4 w-4" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}
