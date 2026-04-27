"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./AdminSidebar";
import { Drawer } from "@/components/ui/Drawer";
import Link from "next/link";
import type { AdminSession } from "@/lib/admin-auth";
import { adminNavGroups } from "./navigation";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { Bell, Menu, Search } from "lucide-react";
import {
  PanelAppearanceProvider,
  type PanelAppearanceMode,
  usePanelAppearance,
} from "@/components/panel/PanelAppearance";

function AdminShellInner({
  children,
  session,
}: {
  children: ReactNode;
  session: AdminSession;
}) {
  const { isLight } = usePanelAppearance();
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();

  const pageTitle = useMemo(() => {
    for (const group of adminNavGroups) {
      const item = group.items.find((entry) => entry.href === pathname);
      if (item) return item.label;
    }
    return "Painel administrativo";
  }, [pathname]);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-surface-base">
      <aside
        className="hidden w-[260px] shrink-0 border-r border-line bg-surface-sidebar md:block"
        aria-label="Navegação admin"
      >
        <AdminSidebar session={session} />
      </aside>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Menu admin">
        <AdminSidebar session={session} onNavigate={() => setDrawer(false)} />
      </Drawer>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-x-3 border-b border-line bg-surface-base/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-surface-base/65 sm:px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-line/70 bg-surface-card/70 text-content-secondary transition duration-200 hover:border-line hover:bg-surface-elevated/60 hover:text-content md:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-faint">Admin</span>
              <span className="text-content-faint/40">·</span>
              <span className="truncate text-sm font-medium text-content">{pageTitle}</span>
            </div>
            <span className="truncate text-sm font-medium text-content sm:hidden">{pageTitle}</span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label className="hidden cursor-text items-center gap-2 rounded-xl border border-line/70 bg-surface-base/80 px-3 py-1 transition duration-200 hover:border-line hover:bg-surface-elevated/60 focus-within:ring-2 focus-within:ring-primary/25 lg:flex">
              <Search className="h-3.5 w-3.5 shrink-0 text-content-faint" strokeWidth={1.75} aria-hidden />
              <input
                type="search"
                placeholder="Buscar clientes, tickets ou faturas"
                className="w-36 bg-transparent text-[13px] text-content outline-none placeholder:text-content-faint focus:w-48 transition-[width] duration-200"
                aria-label="Busca global de clientes"
              />
              <span className="rounded border border-line px-1 py-0.5 text-[10px] font-medium text-content-faint">⌘K</span>
            </label>
            <div
              className={cn(
                "hidden rounded-xl border px-2.5 py-1 text-[11px] font-medium md:block",
                isLight
                  ? "border-primary/20 bg-primary/[0.06] text-content-secondary"
                  : "border-primary/25 bg-primary/[0.08] text-content-secondary",
              )}
            >
              Uptime 99,98%
            </div>
            <button
              type="button"
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-line/70 bg-surface-card/70 text-content-secondary transition duration-200 hover:border-line hover:bg-surface-elevated/60 hover:text-content"
              aria-label="Notificações"
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              <span className="absolute right-2 top-2 h-1 w-1 rounded-full bg-primary" aria-hidden />
            </button>
            <Link
              href="/"
              className="hidden h-8 items-center rounded-xl border border-line/70 bg-surface-card/70 px-3 text-[13px] text-content-secondary transition duration-200 hover:border-line hover:bg-surface-elevated/60 hover:text-content sm:inline-flex"
            >
              Site público
            </Link>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface-base p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Shell persistente do painel administrativo.
 *
 * Renderizado NO LAYOUT (`app/admin/layout.tsx`) para que
 * `PanelAppearanceProvider` nunca desmonte na troca de rota — eliminando
 * o flash de dark mode durante a navegação.
 */
export function AdminShell({
  children,
  session,
  initialPanelTheme,
}: {
  children: ReactNode;
  session: AdminSession;
  initialPanelTheme?: PanelAppearanceMode;
}) {
  return (
    <PanelAppearanceProvider
      panel="admin"
      initialMode={initialPanelTheme}
      className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full overflow-hidden"
    >
      <AdminShellInner session={session}>{children}</AdminShellInner>
    </PanelAppearanceProvider>
  );
}
