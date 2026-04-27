/**
 * Reautenticação simulada na UI (definições de perfil demo).
 * Em produção sem `NEXT_PUBLIC_DEMO_REAUTH_PASSWORD`, só funciona com `NEXT_PUBLIC_SHOW_DEMO_LOGIN_HELP=1`
 * (valor por defeito «admin» alinhado ao login demo no servidor).
 */
export function clientDemoReauthPassword(): string {
  const explicit = process.env.NEXT_PUBLIC_DEMO_REAUTH_PASSWORD?.trim();
  if (explicit) return explicit;
  if (process.env.NEXT_PUBLIC_SHOW_DEMO_LOGIN_HELP === "1") return "admin";
  return "\u0000\u0000__demo_reauth_disabled__";
}
