/**
 * MyChatCRM — Typography Tokens
 *
 * Espelho fiel do Design System (mychatcrm-design-system/src/lib/design-system/typography.ts),
 * adaptado para usar os nomes de tokens Tailwind do sistema (content, content-muted, surface-*).
 *
 * Regras invariantes do DS:
 *  - UI Text: text-sm (14px) com font-medium
 *  - Headings: tracking-tight + leading-tight (valores negativos específicos por escala)
 *  - Controles (button, input, select): font-medium
 *  - Fundos escuros: usar tokens `inverse.*`
 */
export const typography = {
  display: {
    hero:    "font-display text-5xl leading-[1.05] tracking-[-0.03em] font-bold text-content",
    section: "font-display text-4xl leading-tight tracking-[-0.025em] font-semibold text-content",
    feature: "font-display text-3xl leading-tight tracking-[-0.02em] font-semibold text-content",
  },
  heading: {
    h1: "font-display text-4xl leading-tight tracking-[-0.025em] font-semibold text-content",
    h2: "font-display text-3xl leading-tight tracking-[-0.02em] font-semibold text-content",
    h3: "font-sans text-2xl leading-tight tracking-[-0.015em] font-semibold text-content",
    h4: "font-sans text-xl leading-snug tracking-[-0.01em] font-medium text-content",
    h5: "font-sans text-lg leading-snug tracking-[-0.01em] font-medium text-content",
  },
  body: {
    lg:   "font-sans text-lg leading-7 font-normal text-content",
    base: "font-sans text-base leading-6 font-normal text-content",
    sm:   "font-sans text-sm leading-6 font-normal text-content-muted",
    xs:   "font-sans text-xs leading-5 font-normal text-content-muted",
  },
  label: {
    default: "font-sans text-sm leading-none font-medium text-content",
    subtle:  "font-sans text-xs leading-none font-medium uppercase tracking-[0.08em] text-content-muted",
  },
  ui: {
    button:   "font-sans text-sm leading-none font-medium",
    input:    "font-sans text-sm leading-none font-normal",
    caption:  "font-sans text-xs leading-5 text-content-muted",
    table:    "font-sans text-sm leading-5",
    sidebar:  "font-sans text-sm leading-none font-medium",
    kpi:      "font-display text-3xl leading-none tracking-[-0.02em] font-semibold text-content",
    overline: "font-sans text-xs uppercase tracking-[0.12em] font-medium text-content-muted",
    code:     "font-mono text-sm leading-6",
  },
  /** Tokens para elementos sobre fundos escuros (bg-surface-sidebar, bg-primary, cards escuros). */
  inverse: {
    display: {
      hero:    "font-display text-5xl leading-[1.05] tracking-[-0.03em] font-bold text-white",
      section: "font-display text-4xl leading-tight tracking-[-0.025em] font-semibold text-white",
      feature: "font-display text-3xl leading-tight tracking-[-0.02em] font-semibold text-white",
    },
    heading: {
      h1: "font-display text-4xl leading-tight tracking-[-0.025em] font-semibold text-white",
      h2: "font-display text-3xl leading-tight tracking-[-0.02em] font-semibold text-white",
      h3: "font-sans text-2xl leading-tight tracking-[-0.015em] font-semibold text-white",
      h4: "font-sans text-xl leading-snug tracking-[-0.01em] font-medium text-white",
      h5: "font-sans text-lg leading-snug tracking-[-0.01em] font-medium text-white",
    },
    body: {
      lg:   "font-sans text-lg leading-7 font-normal text-white",
      base: "font-sans text-base leading-6 font-normal text-white/90",
      sm:   "font-sans text-sm leading-6 font-normal text-white/80",
      xs:   "font-sans text-xs leading-5 font-normal text-white/70",
    },
    label: {
      default: "font-sans text-sm leading-none font-medium text-white",
      subtle:  "font-sans text-xs leading-none font-medium uppercase tracking-[0.08em] text-white/60",
    },
  },
} as const;
