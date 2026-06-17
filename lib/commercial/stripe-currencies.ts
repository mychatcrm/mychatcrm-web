/**
 * Moedas de apresentação suportadas pelo Stripe.
 * @see https://stripe.com/docs/currencies
 */

export type StripeCurrencyMeta = {
  code: string;
  decimals: 0 | 2 | 3;
};

/** Moedas zero-decimal na API Stripe (valor = menor unidade). */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

/** Moedas com 3 casas decimais na API Stripe. */
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

/** Códigos ISO 4217 suportados pelo Stripe (presentment). */
export const STRIPE_CURRENCY_CODES: readonly string[] = [
  "usd",
  "aed",
  "afn",
  "all",
  "amd",
  "ang",
  "aoa",
  "ars",
  "aud",
  "awg",
  "azn",
  "bam",
  "bbd",
  "bdt",
  "bgn",
  "bhd",
  "bif",
  "bmd",
  "bnd",
  "bob",
  "brl",
  "bsd",
  "bwp",
  "byn",
  "bzd",
  "cad",
  "cdf",
  "chf",
  "clp",
  "cny",
  "cop",
  "crc",
  "cve",
  "czk",
  "djf",
  "dkk",
  "dop",
  "dzd",
  "egp",
  "etb",
  "eur",
  "fjd",
  "fkp",
  "gbp",
  "gel",
  "gip",
  "gmd",
  "gnf",
  "gtq",
  "gyd",
  "hkd",
  "hnl",
  "hrk",
  "htg",
  "huf",
  "idr",
  "ils",
  "inr",
  "isk",
  "jmd",
  "jod",
  "jpy",
  "kes",
  "kgs",
  "khr",
  "kmf",
  "krw",
  "kwd",
  "kyd",
  "kzt",
  "lak",
  "lbp",
  "lkr",
  "lrd",
  "lsl",
  "mad",
  "mdl",
  "mga",
  "mkd",
  "mmk",
  "mnt",
  "mop",
  "mur",
  "mvr",
  "mwk",
  "mxn",
  "myr",
  "mzn",
  "nad",
  "ngn",
  "nio",
  "nok",
  "npr",
  "nzd",
  "omr",
  "pab",
  "pen",
  "pgk",
  "php",
  "pkr",
  "pln",
  "pyg",
  "qar",
  "ron",
  "rsd",
  "rub",
  "rwf",
  "sar",
  "sbd",
  "scr",
  "sek",
  "sgd",
  "shp",
  "sle",
  "sos",
  "srd",
  "std",
  "szl",
  "thb",
  "tjs",
  "tnd",
  "top",
  "try",
  "ttd",
  "twd",
  "tzs",
  "uah",
  "ugx",
  "uyu",
  "uzs",
  "vnd",
  "vuv",
  "wst",
  "xaf",
  "xcd",
  "xcg",
  "xof",
  "xpf",
  "yer",
  "zar",
  "zmw",
] as const;

const STRIPE_CURRENCY_SET = new Set(STRIPE_CURRENCY_CODES);

export function isStripeCurrency(code: string): boolean {
  return STRIPE_CURRENCY_SET.has(code.toLowerCase());
}

export function getCurrencyDecimals(code: string): 0 | 2 | 3 {
  const c = code.toLowerCase();
  if (THREE_DECIMAL.has(c)) return 3;
  if (ZERO_DECIMAL.has(c)) return 0;
  return 2;
}

export function normalizeStripeCurrency(code: string | null | undefined): string {
  const c = String(code ?? "brl")
    .trim()
    .toLowerCase();
  return isStripeCurrency(c) ? c : "brl";
}

let displayNames: Intl.DisplayNames | null = null;

function getDisplayNames(locale: string): Intl.DisplayNames {
  if (!displayNames) {
    displayNames = new Intl.DisplayNames([locale], { type: "currency" });
  }
  return displayNames;
}

export function formatStripeCurrencyLabel(code: string, locale = "pt-BR"): string {
  const normalized = normalizeStripeCurrency(code);
  const upper = normalized.toUpperCase();
  let name: string;
  try {
    name = getDisplayNames(locale).of(upper) ?? upper;
  } catch {
    name = upper;
  }
  return `${upper} - ${name}`;
}

export function currencySymbol(code: string, locale = "pt-BR"): string {
  const normalized = normalizeStripeCurrency(code);
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalized.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? normalized.toUpperCase();
  } catch {
    return normalized.toUpperCase();
  }
}

export function minorUnitsToInputValue(minor: number | null, code: string): string {
  if (minor == null) return "";
  const decimals = getCurrencyDecimals(code);
  if (decimals === 0) return String(minor);
  const factor = 10 ** decimals;
  return (minor / factor).toFixed(decimals);
}

export function inputValueToMinorUnits(value: string, code: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const decimals = getCurrencyDecimals(code);
  if (decimals === 0) return Math.round(parsed);
  const factor = 10 ** decimals;
  return Math.round(parsed * factor);
}

/** BRL primeiro, demais em ordem alfabética. */
export function sortedStripeCurrencyCodes(): string[] {
  const rest = STRIPE_CURRENCY_CODES.filter((c) => c !== "brl").slice().sort();
  return ["brl", ...rest];
}

export const STRIPE_CURRENCIES: StripeCurrencyMeta[] = sortedStripeCurrencyCodes().map((code) => ({
  code,
  decimals: getCurrencyDecimals(code),
}));
