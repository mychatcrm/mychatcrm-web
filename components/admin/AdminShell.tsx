"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./AdminSidebar";
import { Drawer } from "@/components/ui/Drawer";
import Link from "next/link";
import type { AdminSession } from "@/lib/admin-auth";
import { adminNavGroups } from "./navigation";
import { Menu } from "lucide-react";
import {
  PanelAppearanceProvider,
  type PanelAppearanceMode,
} from "@/components/panel/PanelAppearance";

function AdminShellInner({
  children,
  session,
}: {
  children: ReactNode;
  session: AdminSession;
}) {
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
    <div className="panel-shell flex h-full min-h-0 w-full overflow-hidden bg-surface-base">
      <aside
        className="panel-sidebar hidden w-[260px] shrink-0 bg-surface-sidebar md:block"
        aria-label="Navegação admin"
      >
        <AdminSidebar session={session} />
      </aside>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Menu admin">
        <AdminSidebar session={session} onNavigate={() => setDrawer(false)} />
      </Drawer>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="panel-topbar flex h-12 shrink-0 items-center justify-between gap-x-3 bg-surface-base px-4 sm:px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="panel-topbar-control inline-flex h-8 w-8 items-center justify-center rounded-xl border border-line/45 bg-surface-card/55 text-content-secondary transition duration-200 hover:border-line/60 hover:bg-surface-elevated/45 hover:text-content md:hidden"
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
            <Link
              href="/"
              className="panel-topbar-control hidden h-8 items-center rounded-xl border border-line/45 bg-surface-card/55 px-3 text-[13px] text-content-secondary transition duration-200 hover:border-line/60 hover:bg-surface-elevated/45 hover:text-content sm:inline-flex"
            >
              Site público
            </Link>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface-base p-4 sm:p-6 lg:p-8">
            <div className="panel-content-frame panel-content-frame--narrow min-h-0 min-w-0">
              {children}
            </div>
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
