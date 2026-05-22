/** App Secret do app Meta (Lead Ads webhook). Ordem: META_APP_SECRET → FACEBOOK_APP_SECRET. */
export function resolveMetaAppSecret(): string | null {
  const candidates = [
    process.env.META_APP_SECRET,
    process.env.FACEBOOK_APP_SECRET,
    process.env.META_APP_SECRET_KEY,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
