/**
 * Validação de WhatsApp brasileiro.
 *
 * Mais rígida que `validateCheckoutPhone` de propósito: aqui o número é o
 * único canal para avisar a pessoa do lançamento, então um dígito errado
 * significa perder o lead. Além do tamanho, confere se o DDD existe mesmo e
 * se o celular começa por 9 — os dois erros de digitação mais comuns.
 */

/** DDDs em uso no Brasil (Anatel). Qualquer outro é engano de digitação. */
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type WhatsappCheck =
  | { ok: true; digits: string; ddd: string; formatted: string }
  | { ok: false; message: string };

/** Só os dígitos locais (sem o 55 do país), no máximo 11. */
export function whatsappDigits(raw: string): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  return digits.slice(0, 11);
}

/** Máscara progressiva: (62) 99999-9999 — aplicada enquanto a pessoa digita. */
export function formatWhatsapp(raw: string): string {
  const d = whatsappDigits(raw);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function checkWhatsapp(raw: string): WhatsappCheck {
  const digits = whatsappDigits(raw);

  if (!digits) return { ok: false, message: "Informe seu WhatsApp com DDD." };
  if (digits.length < 10) {
    return { ok: false, message: "Número incompleto. Use DDD + número, ex.: (62) 99999-9999." };
  }
  if (digits.length > 11) {
    return { ok: false, message: "Número com dígitos a mais. Confira e tente de novo." };
  }

  const ddd = digits.slice(0, 2);
  if (!VALID_DDDS.has(Number(ddd))) {
    return { ok: false, message: `DDD ${ddd} não existe no Brasil. Confira os dois primeiros dígitos.` };
  }

  const line = digits.slice(2);
  // Celular tem 9 dígitos e começa por 9. Com 8 dígitos é fixo — e o WhatsApp
  // praticamente não existe em fixo, então avisamos em vez de aceitar calado.
  if (line.length === 9 && !line.startsWith("9")) {
    return { ok: false, message: "Celular com 9 dígitos começa por 9. Confira o número." };
  }
  if (line.length === 8) {
    return { ok: false, message: "Parece um telefone fixo. Informe um celular com WhatsApp." };
  }

  return { ok: true, digits, ddd, formatted: formatWhatsapp(digits) };
}
