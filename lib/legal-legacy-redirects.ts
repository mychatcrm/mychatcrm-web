/** Redireciona URLs antigas de legal para as rotas canônicas atuais. */
export function resolveLegacyLegalRedirect(pathname: string): string | null {
  const redirects: Record<string, string> = {
    "/pt-BR/privacidade": "/politica-de-privacidade",
    "/privacidade": "/politica-de-privacidade",
    "/en/privacy": "/en/privacy-policy",
    "/es/privacidad": "/es/politica-de-privacidad",
    "/pt-BR/termos": "/termos-de-uso",
    "/termos": "/termos-de-uso",
    "/en/terms": "/en/terms-of-use",
    "/es/terminos": "/es/terminos-de-uso",
  };
  return redirects[pathname] ?? null;
}
