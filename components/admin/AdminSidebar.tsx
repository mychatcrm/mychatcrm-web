"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { PanelNavIcon } from "@/components/nav/panel-nav-icons";
import type { AdminSession } from "@/lib/admin-auth";
import { hasAdminAccessByRole } from "@/lib/admin-permissions";
import { adminNavGroups } from "./navigation";
import { PanelThemeToggle, usePanelAppearance } from "@/components/panel/PanelAppearance";
import { PanelBrandMark } from "@/components/panel/PanelBrandMark";

export function AdminSidebar({
  session,
  onNavigate,
}: {
  session: AdminSession;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { isLight } = usePanelAppearance();

  const logout = async () => {
    await fetch("/api/auth/admin/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/admin/login";
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex h-16 items-center justify-between gap-2 border-b border-line px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PanelBrandMark size={36} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-bold text-content">
              <span className="text-primary">My</span>ChatCRM
            </p>
            <p className={cn("text-[11px]", isLight ? "text-primary" : "text-primary/90")}>Admin</p>
          </div>
        </div>
        <PanelThemeToggle />
      </div>
      <div className="border-b border-line px-4 py-2.5">
        <div
          className={cn(
            "rounded-xl border px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.18em]",
            isLight ? "border-rose-200 bg-rose-50 text-rose-800" : "border-rose-500/30 bg-rose-500/10 text-rose-200",
          )}
        >
          Painel administrativo
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Menu administrativo">
        {adminNavGroups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className={cn(typography.ui.overline, "panel-nav-section-label mb-1.5 px-2 text-content-faint")}>{group.title}</p>
            <div className="space-y-0.5">
              {group.items
                .filter((it) => hasAdminAccessByRole(session.role, it.routeKey))
                .map((it) => {
                const active = pathname === it.href;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={onNavigate}
                    className={cn(
                      "panel-nav-item group flex h-8 items-center gap-2 rounded-xl border px-2 text-sm font-medium transition duration-200",
                      active && "panel-nav-item--active",
                      active
                        ? "border-transparent bg-primary/10 text-primary"
                        : "border-transparent text-content-secondary hover:bg-surface-elevated/50 hover:text-content",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <PanelNavIcon
                      panel="admin"
                      routeKey={it.routeKey}
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "text-primary" : "text-content-muted group-hover:text-content-secondary",
                      )}
                    />
                    <span className="truncate">{it.label}</span>
                    {active && <span className="ml-auto h-3 w-1 shrink-0 rounded-full bg-primary" aria-hidden />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-2">
        <div className="panel-profile-card flex items-center gap-2.5 rounded-xl border border-line bg-surface-elevated/50 p-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
              isLight ? "bg-brand-secondary" : "bg-primary",
            )}
          >
            {session.initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-content">{session.displayName}</p>
            <p className="truncate text-[11px] text-content-muted">{session.roleLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="panel-topbar-control mt-2 w-full rounded-xl border border-line bg-surface-elevated/50 py-2 text-[13px] text-content-secondary transition duration-200 hover:bg-surface-elevated hover:text-content"
          aria-label="Sair do painel admin"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
