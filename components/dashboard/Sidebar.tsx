"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Circle, Cpu, Moon, Settings, Sun } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "@/lib/plans";
import { cn, formatBRL } from "@/lib/utils";
import type { ClientSession } from "@/lib/client-auth";
import { isMasterClient } from "@/lib/client-auth";
import { formatLeadCount, planMonthlyLeadAllowance } from "@/lib/dashboard-lead-usage";
import {
  organizationRoleCanAccessDashboardRoute,
  organizationRoleCanUseSidebarProfilePopover,
  resolveOrganizationRole,
  sessionCanAccessPersonalSettings,
} from "@/lib/organization-role";
import { useLeadUsageSnapshot } from "@/lib/use-lead-usage-snapshot";
import { dashboardNavPinnedItems, type DashboardNavItem } from "./navigation";
import { PanelBrandMark } from "@/components/panel/PanelBrandMark";
import { getNextPanelAppearanceMode, usePanelAppearance } from "@/components/panel/PanelAppearance";
import { ProfileAvatar, useDashboardProfileAvatar } from "./ProfileAvatar";
import { SidebarCollaboratorProfilePopover } from "./SidebarCollaboratorProfilePopover";
import { PanelNavIcon } from "@/components/nav/panel-nav-icons";
import {
  readExtraSlotsSummary,
  subscribeExtraWhatsAppNumbers,
} from "@/lib/whatsapp-extra-numbers-storage";
import { typography } from "@/lib/typography";

export function Sidebar({
  collapsed,
  session,
  onNavigate,
}: {
  collapsed: boolean;
  session: ClientSession;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const orgRole = resolveOrganizationRole(session);
  const isSellerNav = orgRole === "seller";
  /** Plano, limites de leads, contratação e configurações sensíveis da conta — só o titular (dono). */
  const canManageAccountPlan = sessionCanAccessPersonalSettings(session);
  const canCollaboratorProfilePopover = organizationRoleCanUseSidebarProfilePopover(orgRole);
  const settingsActive = pathname === "/dashboard/configuracoes" || pathname.startsWith("/dashboard/configuracoes/");
  const visibleNavItems = useMemo(
    () => dashboardNavPinnedItems.filter((it) => organizationRoleCanAccessDashboardRoute(orgRole, it.routeKey)),
    [orgRole],
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { isLight, mode, setMode } = usePanelAppearance();
  const workspaceTriggerId = useId();
  const workspacePanelId = useId();
  const workspacePanelTitleId = useId();
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [waSlotSummary, setWaSlotSummary] = useState({ purchased: 0, configured: 0 });
  const [waQty, setWaQty] = useState(1);
  const [waBuying, setWaBuying] = useState(false);
  const [extraSlotsDb, setExtraSlotsDb] = useState(0);
  const [leadsModalOpen, setLeadsModalOpen] = useState(false);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [profilePopoverPos, setProfilePopoverPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const profilePanelId = useId();
  const profileTitleId = useId();
  const { avatar } = useDashboardProfileAvatar(session.initials, session.displayName);

  const workspaceLabel = useMemo(
    () => `${session.displayName.split(" ")[0] ?? "Conta"} · ${session.companyName}`,
    [session.displayName, session.companyName],
  );

  /** Data do fim do ciclo — só no cliente após layout (evita mismatch SSR/cliente por fuso/formato). */
  const [cycleEndLabel, setCycleEndLabel] = useState("…");

  useLayoutEffect(() => {
    const d = new Date();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setCycleEndLabel(end.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }));
  }, []);

  /** Hidratação: 1.º paint = zeros; depois GET `/api/client/lead-usage` (Supabase). */
  const leadSnap = useLeadUsageSnapshot(session.tenantId, session.plan, session.operationalLimits);

  const planLeadsBase = planMonthlyLeadAllowance(session.plan, session.operationalLimits);
  const totalLeadCap = planLeadsBase + leadSnap.bonus;
  const usedLeads = Math.min(leadSnap.used, totalLeadCap);
  const remainingLeads = Math.max(0, totalLeadCap - usedLeads);
  const pctUsed = totalLeadCap > 0 ? Math.min(100, (usedLeads / totalLeadCap) * 100) : 0;
  const pctRemaining = totalLeadCap > 0 ? Math.min(100, (remainingLeads / totalLeadCap) * 100) : 100;

  const remainingLeadsShort = formatLeadCount(remainingLeads);

  const refreshProfilePopoverPos = useCallback(() => {
    const el = profileTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setProfilePopoverPos({ left: r.left, top: r.top, width: r.width });
  }, []);

  const openLeadsModal = () => {
    setProfilePopoverOpen(false);
    setLeadsModalOpen(true);
  };

  const toggleProfilePopover = () => {
    setLeadsModalOpen(false);
    setProfilePopoverOpen((open) => {
      const next = !open;
      if (next) queueMicrotask(() => refreshProfilePopoverPos());
      return next;
    });
  };

  useLayoutEffect(() => {
    if (!profilePopoverOpen) return;
    refreshProfilePopoverPos();
    const onScroll = () => refreshProfilePopoverPos();
    const onResize = () => refreshProfilePopoverPos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [profilePopoverOpen, refreshProfilePopoverPos]);

  useEffect(() => {
    if (!profilePopoverOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (profileTriggerRef.current?.contains(t)) return;
      const portalRoot = document.getElementById(profilePanelId);
      if (portalRoot?.contains(t)) return;
      setProfilePopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfilePopoverOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [profilePopoverOpen, profilePanelId]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (workspaceMenuRef.current?.contains(e.target as Node)) return;
      setWorkspaceMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWorkspaceMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [workspaceMenuOpen]);

  useEffect(() => {
    setWaSlotSummary(readExtraSlotsSummary(session.tenantId));
    return subscribeExtraWhatsAppNumbers(() => setWaSlotSummary(readExtraSlotsSummary(session.tenantId)));
  }, [session.tenantId]);

  useEffect(() => {
    fetch("/api/checkout/extra-whatsapp")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { extraSlots?: number } | null) => {
        if (d) setExtraSlotsDb(d.extraSlots ?? 0);
      })
      .catch(() => {});
  }, [session.tenantId]);

  const logout = async () => {
    await fetch("/api/auth/client/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  };

  const renderNavItem = useCallback(
    (it: DashboardNavItem): ReactNode => {
      const active = pathname === it.href;
      const sellerUnlockLembretes = orgRole === "seller" && it.routeKey === "lembretes";
      const locked = Boolean(it.masterOnly && !isMasterClient(session) && !sellerUnlockLembretes);
      const content = (
        <>
          <PanelNavIcon
            panel="dashboard"
            routeKey={it.routeKey}
            className={cn(
              "text-content-muted transition-colors duration-200 group-hover:text-primary",
              active && "text-primary",
            )}
          />
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {locked ? (
                <Badge
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-semibold",
                    isLight ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-500/35 bg-amber-500/15 text-amber-200",
                  )}
                >
                  Master
                </Badge>
              ) : active ? (
                <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary/90" aria-hidden />
              ) : null}
            </>
          ) : null}
          {collapsed && locked ? (
            <span className="absolute right-1 top-1 rounded-full bg-primary px-1 text-[9px] text-white">M</span>
          ) : null}
        </>
      );

      if (locked) {
        return (
          <button
            key={it.href}
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className={cn(
              "panel-nav-item group relative flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition duration-200 ease-out",
              "text-content-secondary hover:border-primary/20 hover:bg-primary/[0.06] hover:text-content hover:ring-1 hover:ring-primary/15",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
              collapsed && "justify-center px-0",
            )}
            title={collapsed ? it.label : undefined}
          >
            {content}
          </button>
        );
      }

      return (
        <Link
          key={it.href}
          href={it.href}
          onClick={onNavigate}
          className={cn(
            "panel-nav-item group relative flex h-9 items-center rounded-xl px-2.5 text-[13px] font-medium transition duration-200 ease-out",
            active && "panel-nav-item--active",
            active
              ? "border border-transparent bg-primary/10 text-primary"
              : "border border-transparent text-content-secondary hover:border-primary/20 hover:bg-primary/[0.06] hover:text-content hover:ring-1 hover:ring-primary/15",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            collapsed && "justify-center px-0",
          )}
          aria-current={active ? "page" : undefined}
          title={collapsed ? it.label : undefined}
        >
          <span className={cn("flex h-9 w-full items-center gap-2.5", collapsed && "justify-center")}>
            {content}
          </span>
        </Link>
      );
    },
    [collapsed, isLight, onNavigate, orgRole, pathname, session],
  );

  const nextThemeMode = getNextPanelAppearanceMode(mode);
  const themeLabel =
    mode === "light" ? "claro" : mode === "soft-dark" ? "cinza escuro" : "escuro";
  const nextThemeLabel =
    nextThemeMode === "light" ? "claro" : nextThemeMode === "soft-dark" ? "cinza escuro" : "escuro";

  return (
    <>
      <div className="flex h-full flex-col bg-transparent">
        <div className="flex h-auto min-h-16 flex-col justify-center gap-2 px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <PanelBrandMark size={collapsed ? 40 : 36} />
              {!collapsed ? (
                <div className="min-w-0 flex-1">
                  <span className="font-display text-sm font-semibold leading-tight tracking-tight">
                    <span className="text-primary">My</span>
                    <span className="text-content">ChatCRM</span>
                  </span>
                  <p className="text-[11px] text-content-muted">Painel de controle</p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setMode(nextThemeMode)}
              className={cn(
                "panel-topbar-control flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line/80 text-content-muted transition",
                "hover:bg-surface-elevated/35 hover:text-content",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sidebar",
              )}
              aria-label={`Tema atual: ${themeLabel}. Ativar tema ${nextThemeLabel}`}
              title={`Tema atual: ${themeLabel}. Ativar tema ${nextThemeLabel}`}
            >
              {mode === "light" ? (
                <Moon className="h-4 w-4" strokeWidth={2} aria-hidden />
              ) : mode === "soft-dark" ? (
                <Circle className="h-3.5 w-3.5 fill-current" strokeWidth={2} aria-hidden />
              ) : (
                <Sun className="h-4 w-4" strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
          {!collapsed ? (
            isSellerNav ? (
              <div className="panel-profile-card relative mt-1 rounded-xl border border-line/80 bg-surface-deep/60 px-3 py-2 text-left text-[12px] font-medium text-content">
                <p className={cn("truncate", typography.label.default)}>{session.displayName}</p>
                <p className="truncate text-xs text-content-muted">{session.companyName}</p>
              </div>
            ) : (
              <div className="relative mt-1" ref={workspaceMenuRef}>
                <button
                  type="button"
                  id={workspaceTriggerId}
                  aria-haspopup="dialog"
                  aria-expanded={workspaceMenuOpen}
                  aria-controls={workspacePanelId}
                  onClick={() => setWorkspaceMenuOpen((open) => !open)}
                  className="panel-profile-card flex w-full min-h-[40px] items-center justify-between gap-2 rounded-xl border border-line/80 bg-surface-deep/60 px-3 py-2 text-left text-[12px] font-medium text-content transition hover:border-line hover:bg-surface-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <span className="min-w-0 truncate">{workspaceLabel}</span>
                  <span className="shrink-0 text-content-muted" aria-hidden>
                    {workspaceMenuOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </span>
                </button>
                {workspaceMenuOpen ? (
                  <div
                    id={workspacePanelId}
                    role="dialog"
                    aria-labelledby={workspacePanelTitleId}
                    className="panel-floating-card absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-xl border border-line bg-surface-card p-3"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                      <p id={workspacePanelTitleId} className={cn(typography.ui.overline, "text-primary")}>
                        Conta ativa
                      </p>
                    </div>
                    <p className={cn("mt-0.5 truncate", typography.label.default)}>{session.displayName}</p>
                    <p className="truncate text-xs text-content-muted">{session.companyName}</p>
                    <p className="mt-2 text-[11px] leading-relaxed text-content-muted">
                      Todos os planos incluem <span className="font-medium text-content-secondary">1 número</span> no
                      WhatsApp Business (API oficial). Cada número adicional custa{" "}
                      <span className="font-medium text-content-secondary">
                        {formatBRL(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL)}/mês
                      </span>
                      , faturado junto com a conta.
                    </p>
                    {extraSlotsDb > 0 ? (
                      <p className="mt-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-2 py-1.5 text-[11px] text-content-secondary">
                        <span className="font-semibold text-content">Linhas extra contratadas:</span>{" "}
                        {extraSlotsDb}
                        {waSlotSummary.configured < extraSlotsDb ? (
                          <>
                            {" "}
                            · <span className="text-primary">falta configurar em Integrações</span>{" "}
                            {extraSlotsDb - waSlotSummary.configured}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {canManageAccountPlan ? (
                      <>
                        <div className="mt-3 flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label="Diminuir quantidade"
                              disabled={waQty <= 1 || waBuying}
                              onClick={() => setWaQty((q) => Math.max(1, q - 1))}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface-card text-sm font-bold text-content hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              −
                            </button>
                            <span className="w-5 text-center text-sm font-semibold tabular-nums text-content">
                              {waQty}
                            </span>
                            <button
                              type="button"
                              aria-label="Aumentar quantidade"
                              disabled={waQty >= 10 || waBuying}
                              onClick={() => setWaQty((q) => Math.min(10, q + 1))}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface-card text-sm font-bold text-content hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              disabled={waBuying}
                              onClick={async () => {
                                setWaBuying(true);
                                try {
                                  const res = await fetch("/api/checkout/extra-whatsapp", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ quantity: waQty }),
                                  });
                                  if (!res.ok) throw new Error();
                                  const { url } = (await res.json()) as { url: string };
                                  window.open(url, "_blank");
                                } catch {
                                  setWaBuying(false);
                                }
                              }}
                              className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {waBuying ? "Redirecionando…" : "Comprar agora"}
                            </button>
                          </div>
                          <p className="text-[11px] text-content-subtle">
                            {waQty} número{waQty > 1 ? "s" : ""} extra{waQty > 1 ? "s" : ""} — R${" "}
                            {(WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL * waQty).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                            /mês
                          </p>
                        </div>
                        <Link
                          href="/planos"
                          onClick={() => {
                            setWorkspaceMenuOpen(false);
                            onNavigate?.();
                          }}
                          className="mt-2 block text-center text-[10px] font-semibold text-primary underline-offset-2 hover:underline"
                        >
                          Ver planos e limites de leads
                        </Link>
                      </>
                    ) : (
                      <p className="mt-3 text-center text-[10px] leading-relaxed text-content-faint">
                        Contratação de números adicionais e alteração de plano ficam a cargo do titular da conta.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Menu do painel do cliente">
          <div className="space-y-1">{visibleNavItems.map((it) => renderNavItem(it))}</div>
        </nav>

        <div className="px-3 pb-3 pt-2">
          {!collapsed ? (
            <>
              {!isSellerNav && canManageAccountPlan ? (
                <div className="panel-surface-card panel-kpi-card mb-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                      <p className={cn(typography.ui.overline, "text-primary/80")}>Plano ativo</p>
                    </div>
                    <p className="min-w-0 truncate text-right font-display text-sm font-semibold tracking-tight text-primary">{session.planLabel}</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {!isSellerNav && canManageAccountPlan ? (
            <div className={cn("mb-2", collapsed && "flex justify-center")}>
              <button
                type="button"
                onClick={openLeadsModal}
                aria-haspopup="dialog"
                aria-label={`Abrir relatório de uso de leads. ${formatLeadCount(remainingLeads)} restantes neste ciclo, ${Math.round(pctRemaining)} por cento disponível.`}
                title="Ver relatório de uso de leads do plano"
                className={cn(
                  "panel-surface-card rounded-xl border border-line bg-surface-elevated/40 text-left transition hover:border-primary/35 hover:bg-surface-elevated/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  collapsed
                    ? "flex h-10 w-10 flex-col items-center justify-center gap-0.5 p-0"
                    : "w-full px-2 py-1.5",
                )}
              >
                {!collapsed ? (
                  <div className="w-full space-y-1">
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className="shrink-0 text-[11px] font-medium text-content-muted">Leads</span>
                      <span className="min-w-0 truncate text-right text-xs font-semibold tabular-nums text-primary">{remainingLeadsShort}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-deep ring-1 ring-inset ring-line/40">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                          style={{ width: `${pctRemaining}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-content-muted">{Math.round(pctRemaining)}%</span>
                    </div>
                    <p className="text-[10px] text-primary/80">Ver relatório</p>
                  </div>
                ) : (
                  <>
                    <Cpu className="h-4 w-4 text-primary" strokeWidth={2} aria-hidden />
                    <div className="h-0.5 w-6 overflow-hidden rounded-full bg-surface-deep ring-1 ring-inset ring-line/40">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(8, pctRemaining)}%` }}
                      />
                    </div>
                    <span className="text-[8px] font-semibold tabular-nums text-content-muted">{Math.round(pctRemaining)}%</span>
                  </>
                )}
              </button>
            </div>
          ) : null}
          {canManageAccountPlan ? (
            <Link
              href="/dashboard/configuracoes"
              onClick={() => onNavigate?.()}
              className={cn(
                "panel-profile-card group flex min-w-0 items-center gap-3 rounded-xl border px-2 py-2 transition hover:border-line/80 hover:bg-surface-elevated/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                settingsActive ? "border-primary/30 bg-primary/[0.08]" : "border-transparent",
                collapsed ? "flex-col gap-2" : "",
              )}
              aria-label="Abrir configurações da conta"
            >
              <span className="relative shrink-0">
                <ProfileAvatar avatar={avatar} />
                {collapsed ? (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-sidebar text-content-muted transition group-hover:border-primary/35 group-hover:text-primary"
                    aria-hidden
                  >
                    <Settings className="h-3 w-3" strokeWidth={2} />
                  </span>
                ) : null}
              </span>
              {!collapsed ? (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-content transition group-hover:text-primary">
                      {session.displayName}
                    </p>
                    <p className="truncate text-xs text-content-muted">{session.email}</p>
                  </div>
                  <Settings
                    className="h-[18px] w-[18px] shrink-0 text-content-muted transition group-hover:text-primary"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </>
              ) : null}
            </Link>
          ) : canCollaboratorProfilePopover ? (
            <button
              ref={profileTriggerRef}
              type="button"
              onClick={toggleProfilePopover}
              aria-haspopup="dialog"
              aria-expanded={profilePopoverOpen}
              aria-controls={profilePanelId}
              aria-label="Abrir dados do perfil: avatar, e-mail e palavra-passe"
              title={collapsed ? `${session.displayName} — perfil` : undefined}
              className={cn(
                "panel-profile-card group flex w-full min-w-0 items-center gap-3 rounded-xl border px-2 py-2 text-left transition hover:border-line/80 hover:bg-surface-elevated/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                profilePopoverOpen ? "border-primary/30 bg-primary/[0.08]" : "border-transparent",
                collapsed ? "flex-col gap-2" : "",
              )}
            >
              <span className="relative shrink-0">
                <ProfileAvatar avatar={avatar} />
                {collapsed ? (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-sidebar text-content-muted transition group-hover:border-primary/35 group-hover:text-primary"
                    aria-hidden
                  >
                    <Settings className="h-3 w-3" strokeWidth={2} />
                  </span>
                ) : null}
              </span>
              {!collapsed ? (
                <>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-content transition group-hover:text-primary">
                      {session.displayName}
                    </p>
                    <p className="truncate text-xs text-content-muted">{session.email}</p>
                  </div>
                  <Settings
                    className="h-[18px] w-[18px] shrink-0 text-content-muted transition group-hover:text-primary"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </>
              ) : null}
            </button>
          ) : (
            <div
              className={cn(
                "panel-profile-card flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-2 py-2",
                collapsed ? "flex-col gap-2" : "",
              )}
            >
              <span className="relative shrink-0">
                <ProfileAvatar avatar={avatar} />
              </span>
              {!collapsed ? (
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-content">{session.displayName}</p>
                  <p className="truncate text-xs text-content-muted">{session.email}</p>
                </div>
              ) : null}
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            className="panel-topbar-control mt-3 w-full min-h-[40px] rounded-xl border border-line/70 bg-surface-elevated/40 text-[13px] font-medium text-content-secondary transition duration-200 ease-out hover:border-line hover:bg-surface-elevated hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            aria-label="Sair da conta"
          >
            {!collapsed ? "Sair" : "×"}
          </button>
        </div>
      </div>
      {typeof document !== "undefined" &&
      !canManageAccountPlan &&
      canCollaboratorProfilePopover &&
      profilePopoverOpen &&
      profilePopoverPos
        ? createPortal(
            <SidebarCollaboratorProfilePopover
              session={session}
              open={profilePopoverOpen}
              onClose={() => setProfilePopoverOpen(false)}
              anchor={profilePopoverPos}
              panelId={profilePanelId}
              titleId={profileTitleId}
            />,
            document.body,
          )
        : null}
      <Modal
        open={leadsModalOpen}
        onClose={() => setLeadsModalOpen(false)}
        title="Uso de leads"
        className="max-w-md"
        footer={
          <Button type="button" variant="secondary" onClick={() => setLeadsModalOpen(false)}>
            Fechar
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-content-secondary">
          <p className="text-[13px] leading-relaxed text-content-muted">
            Resumo do ciclo mensal do plano <span className="font-medium text-content">{session.planLabel}</span>.
            Renova em <span className="font-medium text-content">{cycleEndLabel}</span>.
          </p>
          <dl className="space-y-2 rounded-xl border border-line bg-surface-deep/40 px-3 py-3 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Incluídos no plano</dt>
              <dd className="font-medium tabular-nums text-content">{formatLeadCount(planLeadsBase)} / mês</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Extra contratado</dt>
              <dd className="font-medium tabular-nums text-primary">{formatLeadCount(leadSnap.bonus)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Total no ciclo</dt>
              <dd className="font-semibold tabular-nums text-content">{formatLeadCount(totalLeadCap)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-line/60 pt-2">
              <dt className="text-content-muted">Leads atendidos</dt>
              <dd className="tabular-nums text-content-secondary">{formatLeadCount(usedLeads)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Restante</dt>
              <dd className="font-semibold tabular-nums text-primary">{formatLeadCount(remainingLeads)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-content-muted">Percentual usado</dt>
              <dd className="tabular-nums text-content">{pctUsed.toFixed(1)}%</dd>
            </div>
          </dl>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-content-muted">
              <span>Disponível no ciclo</span>
              <span className="font-semibold tabular-nums text-content">{Math.round(pctRemaining)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-deep ring-1 ring-inset ring-line/50">
              <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pctRemaining}%` }} />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-content-faint">
            Apenas consulta — o limite mensal conta leads distintos atendidos no ciclo.
          </p>
        </div>
      </Modal>
      <Modal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Desbloqueie recursos do plano superior"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUpgradeOpen(false)}>
              Agora não
            </Button>
            {canManageAccountPlan ? (
              <Button onClick={() => (window.location.href = "/dashboard/configuracoes")}>Fazer upgrade</Button>
            ) : null}
          </>
        }
      >
        <div className="space-y-3 text-sm text-content-secondary">
          {!canManageAccountPlan ? (
            <p className="rounded-xl border border-line/80 bg-surface-deep/50 px-3 py-2 text-xs text-content-muted">
              A contratação ou alteração de plano é feita pelo titular da conta (dono). Peça a essa pessoa para aceder
              a Configurações ou fale com o suporte.
            </p>
          ) : null}
          <p>Este módulo requer um plano com limite de leads e recursos alinhados à sua operação.</p>
          <ul className="space-y-2 rounded-xl border border-line bg-surface-deep p-4">
            <li>Disparos em massa com audiências segmentadas</li>
            <li>Lembretes automáticos recorrentes</li>
            <li>Maior limite mensal de leads atendidos e operações simultâneas</li>
          </ul>
        </div>
      </Modal>
    </>
  );
}
