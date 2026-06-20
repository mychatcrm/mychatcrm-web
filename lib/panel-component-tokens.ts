/**
 * MyChatCRM — Panel Component Tokens
 *
 * Tokens de estilo EXCLUSIVOS para /dashboard e /admin.
 * NUNCA importar em components/ui/, app/landing/, app/login/, app/checkout/ ou components/chat/.
 *
 * Estes valores refletem o Design System (mychatcrm-design-system) sem afetar páginas públicas.
 */

/** Tamanhos de botão do painel (DS) — padding generoso, sem min-h forçado */
export const PANEL_BUTTON_SIZES = {
  xs: "px-3 py-1.5 text-[10px]",
  sm: "px-5 py-2.5 text-xs",
  md: "px-7 py-3.5 text-sm",
  lg: "px-10 py-[1.125rem] text-base font-bold",
} as const;

export type PanelButtonSize = keyof typeof PANEL_BUTTON_SIZES;

/** Classes base de input do painel (DS) — bg-surface-base, py-3.5, focus bg-surface-deep, zero shadow */
export const PANEL_INPUT_BASE =
  "w-full rounded-xl border border-line/45 [background:var(--panel-section-fill)] px-4 py-3 text-sm font-normal text-content shadow-[var(--panel-shadow-edge)] transition-all duration-150 placeholder:text-content-faint hover:border-primary/25 hover:bg-surface-elevated/50 focus:border-primary/55 focus:bg-surface-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60 sm:py-3.5";
