/**
 * Resend API key resolution — single place for password recovery + transactional mail.
 * Vercel / Resend integration uses RESEND_API_KEY (see .env.example).
 */

export function getResendApiKey(): string | undefined {
  const a = process.env.RESEND_API_KEY?.trim();
  if (a) return a;
  // Rare alternate names (some templates / older docs)
  const b = process.env.RESEND_TOKEN?.trim();
  if (b) return b;
  return undefined;
}

export function isResendConfigured(): boolean {
  return Boolean(getResendApiKey());
}

export function getResendFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "MyChatCRM <onboarding@resend.dev>";
  return from.match(/<([^>]+)>/)?.[1]?.trim() || from;
}

export function isResendTestSender(): boolean {
  return getResendFromEmail().toLowerCase().endsWith("@resend.dev");
}
