/**
 * Redirecionamentos pós-login na mesma origem — bloqueia open redirect (`//evil.com`, `https://...`).
 */
export function safeAppInternalPath(from: string | null | undefined, fallback: string): string {
  const raw = from?.trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

/**
 * Destino após login admin: apenas sob `/admin`, nunca a própria página de login.
 */
export function safeAdminPostLoginPath(from: string | null | undefined, fallback: string): string {
  const base = safeAppInternalPath(fallback, "/admin");
  const raw = safeAppInternalPath(from, "");
  if (!raw) return base;
  if (!raw.startsWith("/admin")) return base;
  if (raw === "/admin/login" || raw.startsWith("/admin/login/") || raw.startsWith("/admin/login?")) return base;
  return raw;
}
