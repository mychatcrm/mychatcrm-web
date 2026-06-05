"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { DashboardOverviewDateFilter } from "./DashboardWorkspace";
import Link from "next/link";
import { Drawer } from "@/components/ui/Drawer";
import type { ClientSession } from "@/lib/client-auth";
import { dashboardNavPinnedItems } from "./navigation";
import { PanelAppearanceProvider, type PanelAppearanceMode } from "@/components/panel/PanelAppearance";
import { CrmFunnelsProvider } from "./CrmFunnelsContext";
import { cn } from "@/lib/utils";
import { Bell, Menu, Search } from "lucide-react";

function DashboardShellInner({
  children,
  session,
}: {
  children: ReactNode;
  session: ClientSession;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();

  /** Em md+ fecha o drawer automaticamente. */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => { if (mq.matches) setDrawer(false); };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const pageTitle = useMemo(() => {
    const path = pathname ?? "";
    if (path === "/dashboard/configuracoes" || path.startsWith("/dashboard/configuracoes/")) {
      return "Configurações";
    }
    const pinned = dashboardNavPinnedItems.find((entry) => entry.href === path);
    if (pinned) return pinned.headerTitle ?? pinned.label;
    return "Painel do cliente";
  }, [pathname]);

  /** Controles do shell — flat (design system): só cor/borda. */
  const shellControl = cn(
    "panel-topbar-control",
    "rounded-xl border border-line/45 bg-surface-card/55 text-content-secondary",
    "transition duration-200 ease-out",
    "hover:bg-surface-elevated/45 hover:text-content hover:border-line/60",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
  );

  /** O filtro de datas da visão geral só aparece em `/dashboard` (índice). */
  const isOverview = pathname === "/dashboard";

  return (
    <div
      className="panel-shell flex h-full min-h-0 overflow-hidden"
      // data-sidebar-collapsed é consumido por @media+seletores em app/globals.css
      // para definir --mc-sidebar-w (240/64/0 conforme breakpoint+collapse).
      // Inline style aqui criaria specificity acima da media query e quebraria mobile.
      data-sidebar-collapsed={collapsed ? "true" : "false"}
    >
      <aside
        className={`panel-sidebar hidden shrink-0 bg-surface-sidebar md:block ${
          collapsed ? "w-16" : "w-[240px]"
        } transition-[width]`}
        aria-label="Navegação lateral do cliente"
      >
        {!drawer ? <Sidebar collapsed={collapsed} session={session} /> : null}
      </aside>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Menu do cliente">
        <Sidebar collapsed={false} session={session} onNavigate={() => setDrawer(false)} />
      </Drawer>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="panel-topbar flex h-12 shrink-0 items-center px-4 sm:px-6 xl:px-8">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                className={cn(shellControl, "inline-flex h-8 w-8 items-center justify-center text-content md:hidden")}
                onClick={() => setDrawer(true)}
                aria-label="Abrir menu"
              >
                <Menu className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                className={cn(shellControl, "hidden h-8 items-center px-2.5 text-xs md:inline-flex")}
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
              >
                {collapsed ? "⟩" : "⟨"}
              </button>
              <div className="hidden items-center gap-2 sm:flex">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-faint">Painel</span>
                <span className="text-content-faint/40">·</span>
                <span className="truncate text-sm font-medium text-content">{pageTitle}</span>
              </div>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-content sm:hidden">{pageTitle}</span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <label
                className={cn(
                  shellControl,
                  "hidden cursor-text items-center gap-2 px-3 py-1 lg:flex",
                  "focus-within:ring-2 focus-within:ring-primary/25",
                )}
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-content-faint" strokeWidth={1.75} aria-hidden />
                <input
                  type="search"
                  placeholder="Buscar leads, conversas ou eventos"
                  className="w-36 bg-transparent text-[13px] text-content outline-none placeholder:text-content-faint focus:w-48 transition-[width] duration-200"
                  aria-label="Busca global"
                />
                <span className="rounded border border-line px-1 py-0.5 text-[10px] font-medium text-content-faint">⌘K</span>
              </label>

              {isOverview && (
                <Suspense
                  fallback={
                    <span className="inline-flex h-9 min-w-[8rem] max-w-[9rem] animate-pulse rounded-xl border border-line/60 bg-surface-elevated/35 px-3 sm:min-w-[10.5rem] sm:max-w-none" />
                  }
                >
                  <DashboardOverviewDateFilter />
                </Suspense>
              )}

              <Link
                href="/dashboard/lembretes"
                className={cn(shellControl, "relative inline-flex h-8 w-8 items-center justify-center")}
                aria-label="Ver lembretes"
                title="Lembretes"
              >
                <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                <span className="absolute right-2 top-2 h-1 w-1 rounded-full bg-primary" aria-hidden />
              </Link>
              <Link
                href="/"
                className={cn(shellControl, "hidden h-8 items-center px-3 text-[13px] sm:inline-flex")}
              >
                Site
              </Link>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden [background:var(--panel-workspace-fill)]">
          {/* Full-bleed routes (conversas, agenda) recebem o conteúdo directamente,
              sem padding nem panel-content-frame, para preencher toda a <main>.
              Dimensões explícitas (100% × calc(100dvh - 48px)) garantem o full-bleed
              mesmo se algum ancestral perder contexto de sizing. */}
          {pathname.startsWith("/dashboard/conversas") || pathname.startsWith("/dashboard/agenda") ? (
            <div
              className="flex flex-col overflow-hidden"
              style={{
                width: "100%",
                height: "calc(100dvh - 48px)", // 48px = h-12 do header
              }}
            >
              {children}
            </div>
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [background:var(--panel-workspace-fill)] p-4 sm:p-6 lg:p-8">
              <div className="panel-content-frame min-h-0 min-w-0">
                {children}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Shell persistente do painel do cliente.
 *
 * Renderizado NO LAYOUT (`app/dashboard/layout.tsx`) para que
 * `PanelAppearanceProvider` e `CrmFunnelsProvider` nunca desmontem
 * na troca de rota — eliminando o flash de dark mode.
 */
export function DashboardShell({
  children,
  session,
  initialPanelTheme,
}: {
  children: ReactNode;
  session: ClientSession;
  /** Cookie `mychatcrm-panel-appearance` (light/dark) — evita flash no primeiro carregamento. */
  initialPanelTheme?: PanelAppearanceMode;
}) {
  return (
    <PanelAppearanceProvider
      panel="dashboard"
      initialMode={initialPanelTheme}
      className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full overflow-hidden"
    >
      <CrmFunnelsProvider clientPlan={session.plan} operationalLimits={session.operationalLimits}>
        <DashboardShellInner session={session}>
          {children}
        </DashboardShellInner>
      </CrmFunnelsProvider>
    </PanelAppearanceProvider>
  );
}
