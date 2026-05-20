import type { Locale } from "@/i18n/routing";

/** Pathnames internos do next-intl (chave em `i18n/routing.ts`). */
export const LEGAL_PRIVACY_PATHNAME = "/politica-de-privacidade" as const;
export const LEGAL_TERMS_PATHNAME = "/termos-de-uso" as const;

const PRIVACY_SLUG: Record<Locale, string> = {
  "pt-BR": "/politica-de-privacidade",
  en: "/privacy-policy",
  es: "/politica-de-privacidad",
};

const TERMS_SLUG: Record<Locale, string> = {
  "pt-BR": "/termos-de-uso",
  en: "/terms-of-use",
  es: "/terminos-de-uso",
};

const PRIVACY_ALIASES = new Set([
  "/politica-de-privacidade",
  "/privacy-policy",
  "/politica-de-privacidad",
  "/privacidade",
  "/privacy",
  "/privacidad",
]);

const TERMS_ALIASES = new Set([
  "/termos-de-uso",
  "/terms-of-use",
  "/terminos-de-uso",
  "/termos",
  "/terms",
  "/terminos",
]);

/** URL pública completa (PT sem prefixo; EN/ES com prefixo de locale). */
export function localizedLegalPrivacyHref(locale: Locale): string {
  const slug = PRIVACY_SLUG[locale];
  return locale === "pt-BR" ? slug : `/${locale}${slug}`;
}

export function localizedLegalTermsHref(locale: Locale): string {
  const slug = TERMS_SLUG[locale];
  return locale === "pt-BR" ? slug : `/${locale}${slug}`;
}

export function canonicalizeLegalPrivacyPath(path: string): typeof LEGAL_PRIVACY_PATHNAME | null {
  let canonical = path.replace(/^\/(pt-BR|en|es)(?=\/|$)/, "");
  if (canonical === "") canonical = "/";
  if (PRIVACY_ALIASES.has(canonical)) return LEGAL_PRIVACY_PATHNAME;
  return null;
}

export function canonicalizeLegalTermsPath(path: string): typeof LEGAL_TERMS_PATHNAME | null {
  let canonical = path.replace(/^\/(pt-BR|en|es)(?=\/|$)/, "");
  if (canonical === "") canonical = "/";
  if (TERMS_ALIASES.has(canonical)) return LEGAL_TERMS_PATHNAME;
  return null;
}

export function localizeLegalPrivacyPath(
  canonicalPath: typeof LEGAL_PRIVACY_PATHNAME,
  locale: Locale,
): string {
  return localizedLegalPrivacyHref(locale);
}

export function localizeLegalTermsPath(
  canonicalPath: typeof LEGAL_TERMS_PATHNAME,
  locale: Locale,
): string {
  return localizedLegalTermsHref(locale);
}

/** Paths públicos localizados (EN/ES) — usados em maintenance e testes. */
export const LOCALIZED_LEGAL_PUBLIC_PATHS = [
  "/en/privacy-policy",
  "/en/terms-of-use",
  "/es/politica-de-privacidad",
  "/es/terminos-de-uso",
] as const;
