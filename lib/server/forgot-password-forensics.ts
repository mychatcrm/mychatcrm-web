/**
 * Diagnóstico forense opcional (ativar com FORGOT_PASSWORD_FORENSIC=1 na Vercel).
 * Usa console.warn/error — em produção, console.log é removido pelo next.config (removeConsole).
 * Após RCA: desativar a env e, se quiser zero superfície, apagar este ficheiro e os blocos associados em forgot-password / password-reset.
 */
export function isForgotPasswordForensicEnabled(): boolean {
  return process.env.FORGOT_PASSWORD_FORENSIC?.trim() === "1";
}

export function forgotPasswordForensicPayload(request: Request): Record<string, string | boolean> {
  let hostFromRequestUrl = "invalid_request_url";
  try {
    hostFromRequestUrl = new URL(request.url).host;
  } catch {
    /* keep default */
  }
  return {
    marker: "FORGOT_PASSWORD_V2_ACTIVE",
    hasApiKey: Boolean(process.env.RESEND_API_KEY?.trim()),
    hasResendToken: Boolean(process.env.RESEND_TOKEN?.trim()),
    hasFromEmail: Boolean(process.env.RESEND_FROM_EMAIL?.trim()),
    vercelEnv: process.env.VERCEL_ENV ?? "undefined",
    nodeEnv: process.env.NODE_ENV ?? "undefined",
    hostFromRequestUrl,
  };
}
