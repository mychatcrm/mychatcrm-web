/**
 * Rotas que o middleware deixa passar sem verificar manutenção (evita loop e permite leitura do estado).
 */
export function isMaintenanceStatusApiPath(pathname: string): boolean {
  return pathname === "/api/maintenance/status";
}

/**
 * Rotas acessíveis sem sessão admin durante manutenção.
 * Inclui toda a árvore `/admin/*` para o middleware de autenticação admin redirecionar para login quando necessário.
 */
export function isMaintenanceAnonymousAllowPath(pathname: string): boolean {
  // Accept all localized variants of the maintenance page
  if (pathname === "/manutencao") return true;
  if (pathname === "/en/maintenance") return true;
  if (pathname === "/es/mantenimiento") return true;
  if (pathname === "/reset-password") return true;
  if (pathname === "/forgot-password") return true;
  if (pathname === "/en/forgot-password") return true;
  if (pathname === "/es/forgot-password") return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname.startsWith("/api/auth/admin/")) return true;
  if (pathname.startsWith("/api/auth/forgot-password")) return true;
  if (pathname.startsWith("/api/auth/reset-password")) return true;
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/api/admin/")) return true;
  /* Futuros webhooks: validar assinatura nas rotas; não bloquear aqui. */
  if (pathname.startsWith("/api/webhooks/")) return true;
  return false;
}
