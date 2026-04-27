export const typography = {
  display: {
    hero: "font-display text-5xl leading-[1.05] tracking-[-0.03em] font-bold text-brand-text",
    section: "font-display text-4xl leading-tight tracking-[-0.025em] font-semibold text-brand-text",
    feature: "font-display text-3xl leading-tight tracking-[-0.02em] font-semibold text-brand-text",
  },
  heading: {
    h1: "font-display text-4xl leading-tight tracking-[-0.025em] font-semibold text-brand-text",
    h2: "font-display text-3xl leading-tight tracking-[-0.02em] font-semibold text-brand-text",
    h3: "font-sans text-2xl leading-tight tracking-[-0.015em] font-semibold text-brand-text",
    h4: "font-sans text-xl leading-snug tracking-[-0.01em] font-medium text-brand-text",
    h5: "font-sans text-lg leading-snug tracking-[-0.01em] font-medium text-brand-text",
  },
  body: {
    lg: "font-sans text-lg leading-7 font-normal text-brand-text",
    base: "font-sans text-base leading-6 font-normal text-brand-text",
    sm: "font-sans text-sm leading-6 font-normal text-brand-text-muted",
    xs: "font-sans text-xs leading-5 font-normal text-brand-text-muted",
  },
  label: {
    default: "font-sans text-sm leading-none font-medium text-brand-text",
    subtle: "font-sans text-xs leading-none font-medium uppercase tracking-[0.08em] text-brand-text-muted",
  },
  ui: {
    button: "font-sans text-sm leading-none font-medium",
    input: "font-sans text-sm leading-none font-normal",
    caption: "font-sans text-xs leading-5 text-brand-text-muted",
    table: "font-sans text-sm leading-5",
    sidebar: "font-sans text-sm leading-none font-medium",
    kpi: "font-display text-3xl leading-none tracking-[-0.02em] font-semibold text-brand-text",
    overline: "font-sans text-xs uppercase tracking-[0.12em] font-medium text-brand-text-muted",
    code: "font-mono text-sm leading-6",
  },
  // Inverse tokens for Dark backgrounds
  inverse: {
    display: {
      hero: "font-display text-5xl leading-[1.05] tracking-[-0.03em] font-bold text-white",
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
      lg: "font-sans text-lg leading-7 font-normal text-white",
      base: "font-sans text-base leading-6 font-normal text-white/90",
      sm: "font-sans text-sm leading-6 font-normal text-white/80",
      xs: "font-sans text-xs leading-5 font-normal text-white/70",
    },
    label: {
      default: "font-sans text-sm leading-none font-medium text-white",
      subtle: "font-sans text-xs leading-none font-medium uppercase tracking-[0.08em] text-white/60",
    },
  }
} as const;
