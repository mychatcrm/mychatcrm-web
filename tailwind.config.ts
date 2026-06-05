import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#f24400",
          hover: "#B22A00",
          light: "rgba(242, 68, 0, 0.15)",
          glow: "rgba(242, 68, 0, 0.35)",
        },
        surface: {
          base: "rgb(var(--color-surface-base) / <alpha-value>)",
          deep: "rgb(var(--color-surface-deep) / <alpha-value>)",
          sidebar: "rgb(var(--color-surface-sidebar) / <alpha-value>)",
          card: "rgb(var(--color-surface-card) / <alpha-value>)",
          elevated: "rgb(var(--color-surface-elevated) / <alpha-value>)",
          brown: "rgb(var(--color-surface-brown) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--color-line) / <alpha-value>)",
          hover: "#f24400",
        },
        content: {
          DEFAULT: "rgb(var(--color-content) / <alpha-value>)",
          secondary: "rgb(var(--color-content-secondary) / <alpha-value>)",
          muted: "rgb(var(--color-content-muted) / <alpha-value>)",
          faint: "rgb(var(--color-content-faint) / <alpha-value>)",
        },
        success: "#00A650",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",
          /** DS brand tokens — use these in new components */
        brand: {
          primary:          "#F24400",
          secondary:        "#0E1D29",
          "secondary-orange": "#B22A00",
          success:   "#00A650",
          dark:      "#000000",
          bg:        "#F2F2F2",
          border:    "#e2e8f0",
          text:      "#09090b",
          "text-muted": "#71717a",
          "sidebar-bg": "#F2F2F2",
          surface:   "#FFFFFF",
        },
      },
      fontFamily: {
        display: ["var(--font-inter)", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, #F24400, #F24400)",
        "gradient-dark": "linear-gradient(135deg, #0E1D29, #0E1D29)",
        "gradient-highlight": "linear-gradient(135deg, #F24400, #F24400)",
        "gradient-glow": "linear-gradient(135deg, transparent, transparent)",
        "gradient-hero":
          "radial-gradient(circle at 50% 20%, rgba(242,68,0,0.12) 0%, transparent 55%), radial-gradient(circle at 90% 0%, rgba(255,106,0,0.08) 0%, transparent 45%)",
      },
      boxShadow: {
        "cta-glow": "none",
        "card-hover-glow": "none",
        "primary-glow": "none",
        /**
         * Escala neutra de elevação (inspiração Linear/Stripe). Mantém profundidade em temas claro/escuro
         * sem recorrer a `drop-shadow` de laranja, que poluía o look.
         */
        "elevation-1": "none",
        "elevation-2": "none",
        "elevation-3": "none",
        "inset-hairline": "inset 0 0 0 1px rgb(var(--color-line) / 0.65)",
        "focus-ring": "0 0 0 2px rgb(var(--color-surface-base)), 0 0 0 4px rgba(242,68,0,0.55)",
      },
      borderRadius: {
        "2.5xl": "0.75rem",
        /** Radius oficial do DS: reduzido e consistente também nas áreas públicas. */
        sm:    "0.125rem",
        md:    "0.225rem",
        lg:    "0.3rem",
        xl:    "0.45rem",
        "2xl": "0.6rem",
        "3xl": "0.9rem",
        /** DS panel radii (40% reduction) — use ONLY inside /dashboard and /admin */
        "panel-sm":  "0.075rem",
        "panel-md":  "0.225rem",
        "panel-lg":  "0.3rem",
        "panel-xl":  "0.45rem",
        "panel-2xl": "0.6rem",
        "panel-3xl": "0.9rem",
      },
      keyframes: {
        "pulse-orange": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(242,68,0,0.4)" },
          "50%": { boxShadow: "0 0 0 8px rgba(242,68,0,0)" },
        },
        /** Mesh do hero — posição/opacidade assimétricas (12s). */
        "hero-mesh-shift": {
          "0%, 100%": {
            opacity: "0.55",
            transform: "translate(-6%, -4%) scale(1.05)",
          },
          "50%": { opacity: "0.85", transform: "translate(4%, 6%) scale(1.12)" },
        },
        "landing-shimmer": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(120%)" },
        },
        "landing-float-slow": {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(8%, 4%)" },
        },
        "landing-float-slower": {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(-6%, -5%)" },
        },
        "landing-rotate-border": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "pulse-orange": "pulse-orange 2s ease-in-out infinite",
        "hero-mesh-shift": "hero-mesh-shift 12s ease-in-out infinite alternate",
        "landing-shimmer": "landing-shimmer 2.8s ease-in-out infinite",
        "landing-float-slow": "landing-float-slow 18s ease-in-out infinite",
        "landing-float-slower": "landing-float-slower 24s ease-in-out infinite",
        "landing-rotate-border": "landing-rotate-border 10s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
