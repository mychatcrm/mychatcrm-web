import { routing } from "@/i18n/routing";

/** Rotas públicas fora de `app/[locale]` — sem prefixo de idioma na URL. */
export const UNLOCALIZED_PUBLIC_PATHS = [
  "/reset-password",
  "/politica-de-privacidade",
  "/termos-de-uso",
] as const;

export type UnlocalizedPublicPath = (typeof UNLOCALIZED_PUBLIC_PATHS)[number];

function isUnlocalizedPublicPath(path: string): path is UnlocalizedPublicPath {
  return (UNLOCALIZED_PUBLIC_PATHS as readonly string[]).includes(path);
}

/**
 * Resolve rotas públicas sem locale.
 * Ex.: `/pt-BR/politica-de-privacidade` → `/politica-de-privacidade`
 */
export function resolveUnlocalizedPublicPath(pathname: string): UnlocalizedPublicPath | null {
  if (isUnlocalizedPublicPath(pathname)) return pathname;

  for (const locale of routing.locales) {
    const prefix = `/${locale}`;
    if (!pathname.startsWith(`${prefix}/`)) continue;
    const rest = pathname.slice(prefix.length);
    if (isUnlocalizedPublicPath(rest)) return rest;
  }

  return null;
}
