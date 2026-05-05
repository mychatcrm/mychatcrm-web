/**
 * Segredo para AES-GCM da chave OpenAI guardada em `admin_platform_openai`.
 * Preferir PLATFORM_OPENAI_KEY_SECRET; se ausente, reutiliza CLIENT_SESSION_COOKIE_SECRET
 * (já obrigatório em muitos deploys com /admin) para reduzir fricção.
 */
export function getPlatformOpenAiEncryptionSecret(): string | null {
  const direct = process.env.PLATFORM_OPENAI_KEY_SECRET?.trim();
  if (direct && direct.length >= 8) return direct;
  const fallback = process.env.CLIENT_SESSION_COOKIE_SECRET?.trim();
  if (fallback && fallback.length >= 8) return fallback;
  return null;
}
