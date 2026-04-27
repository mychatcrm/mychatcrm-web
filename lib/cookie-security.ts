/**
 * Define se cookies de sessão devem usar o flag `Secure`.
 * Com `NODE_ENV=production` e `secure: true`, navegadores **não gravam** o cookie em
 * `http://localhost` / `http://127.0.0.1` — o login parece ok mas o painel cai ou redireciona.
 */
export function cookieSecureFlag(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.COOKIE_INSECURE === "1") return false;
  if (process.env.COOKIE_FORCE_SECURE === "1") return true;

  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  if (!site) return false;
  const lower = site.toLowerCase();
  if (lower.startsWith("http://")) return false;
  if (/(localhost|127\.0\.0\.1)/i.test(lower)) return false;

  try {
    const withScheme = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    return new URL(withScheme).protocol === "https:";
  } catch {
    return false;
  }
}
