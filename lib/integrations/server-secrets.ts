/**
 * Validação mínima de secrets no servidor — evita deploy com placeholders óbvios.
 */

const PLACEHOLDERS = new Set([
  "",
  "sua_key_aqui",
  "changeme",
  "placeholder",
  "your-api-key",
  "sk-...",
  "xxx",
]);

export function isUsableApiSecret(value: string | undefined): boolean {
  if (value == null) return false;
  const t = value.trim();
  if (!t) return false;
  if (PLACEHOLDERS.has(t.toLowerCase())) return false;
  if (t.length < 8) return false;
  return true;
}
