/**
 * DDD (código de área) de um telefone brasileiro. Aceita com ou sem o "55"
 * do país e com ou sem o 9º dígito — número real tem 55 + 2 dígitos de DDD
 * + 8 ou 9 dígitos da linha (12 ou 13 dígitos com país; 10 ou 11 sem).
 * Devolve `null` pra qualquer coisa curta demais pra ter DDD de verdade.
 */
export function extractBrazilianDdd(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length < 10) return null;
  return local.slice(0, 2);
}
