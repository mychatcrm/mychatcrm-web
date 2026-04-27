/**
 * Formatação numérica determinística para o painel (SSR + hidratação).
 *
 * Evitamos `Intl`/`toLocaleString` sem controlo fino para contagens compactas porque
 * o objetivo é **a mesma string** para a mesma entrada em Node (SSR) e no browser.
 *
 * Regra de arredondamento (compacto milhões, sufixo M):
 * - Divide por 1_000_000, aplica `toFixed(fractionDigits)` em valor absoluto (half-up do IEEE).
 * - Separador decimal: vírgula (pt-BR). Separador de milhares no inteiro: ponto.
 */

export const PANEL_NUMBER_LOCALE_TAG = "pt-BR" as const;

function isInvalidNumber(n: number) {
  return !Number.isFinite(n);
}

/** Inteiros com agrupamento de milhares `1.234.567` (pt-BR); sinal `-` preservado. */
export function formatIntegerPtBr(n: number): string {
  if (isInvalidNumber(n)) return "—";
  const rounded = Math.trunc(n);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const s = String(abs);
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}`;
}

/**
 * Valor absoluto ≥ 1M → `"19,9M"` (uma casa decimal) — métricas compactas no painel.
 * Valores abaixo de 1M devem usar `formatIntegerPtBr` em vez desta função.
 */
export function formatMillionsShortPtBr(amount: number, fractionDigits = 1): string {
  if (isInvalidNumber(amount) || amount < 0) return "—";
  const millions = amount / 1_000_000;
  const s = millions.toFixed(fractionDigits);
  const [intRaw, frac] = s.split(".");
  const intWithSep = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac !== undefined ? `${intWithSep},${frac}M` : `${intWithSep}M`;
}

/** Compactação tipo métricas de demo: ≥1M → `x,xM`; ≥10k → `nK`; senão inteiro arredondado ao milhar. */
export function formatDemoCreditsCompactPtBr(value: number): string {
  if (isInvalidNumber(value)) return "—";
  const v = Math.floor(Math.abs(value)) * (value < 0 ? -1 : 1);
  if (Math.abs(v) >= 1_000_000) return formatMillionsShortPtBr(Math.abs(v), 1);
  if (Math.abs(v) >= 10_000) {
    const k = Math.round(Math.abs(v) / 1000);
    const sign = v < 0 ? "-" : "";
    return `${sign}${formatIntegerPtBr(k)}K`;
  }
  const rounded = Math.max(0, Math.round(v / 1000) * 1000);
  return formatIntegerPtBr(rounded);
}
