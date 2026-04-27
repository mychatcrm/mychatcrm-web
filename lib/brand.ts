/**
 * MyChatCRM — identidade visual (referência única para TS e documentação).
 * Cores em hex; superfícies do painel usam RGB espaçado em `panel-appearance.css`.
 *
 * - Laranja vibrante: ação primária e destaque
 * - Laranja dark: hover/pressed e profundidade
 * - Azul carvão: base institucional escura (texto em claro / fundo em escuro)
 * - Cinza claro / branco: superfícies neutras em modo claro
 */
export const BRAND = {
  orange: "#F24400",
  orangeDark: "#B22A00",
  charcoal: "#0E1D2F",
  light: "#F2F2F2",
  white: "#FFFFFF",
} as const;

/** Cor primária da marca (atalho para metadata / viewport). */
export const BRAND_ORANGE = BRAND.orange;

/** URLs públicas da identidade (raiz `public/` + variações em `public/branding/`). */
export const BRAND_LOGO = {
  /** Marca principal (UI, JSON-LD). */
  default: "/logo.svg",
  /** Ícone compacto (favicon, atalhos). */
  icon: "/logo-icon.svg",
  /** Fallback raster (Apple touch, ambientes sem SVG). */
  png: "/logo.png",
  horizontal: "/branding/logo-horizontal.svg",
  mono: "/branding/logo-mono.svg",
} as const;
