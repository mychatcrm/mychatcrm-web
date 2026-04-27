/**
 * Controlo de logins «demo» (senhas estáticas, contas de exemplo, fallback mágico).
 * Em produção na Vercel fica desativado salvo `ALLOW_DEMO_PASSWORD_AUTH=1`.
 */

function explicitAllow(): boolean | null {
  const v = process.env.ALLOW_DEMO_PASSWORD_AUTH?.trim();
  if (v === "1") return true;
  if (v === "0") return false;
  return null;
}

/** Produção alojada (Vercel). */
export function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Permite `authenticateClient` / `authenticateAdmin`, tokens de sessão demo estáticos
 * e o fallback «qualquer e-mail + senha demo» no login de cliente.
 */
export function allowDemoPasswordLogin(): boolean {
  const ex = explicitAllow();
  if (ex !== null) return ex;
  if (isVercelProduction()) return false;
  /* `next start` local com NODE_ENV=production: fechado por defeito. */
  if (process.env.NODE_ENV === "production") return false;
  return true;
}
