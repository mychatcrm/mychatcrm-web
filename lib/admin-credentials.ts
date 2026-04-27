/**
 * Apenas dicas opcionais para UI de login (NEXT_PUBLIC_*).
 * Credenciais demo reais vivem no servidor (`lib/admin-auth.ts`) quando `ALLOW_DEMO_PASSWORD_AUTH=1`.
 */
export const ADMIN_DEMO_EMAIL_PLACEHOLDER =
  process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL?.trim() || "";
