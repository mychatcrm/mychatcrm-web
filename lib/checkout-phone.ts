export type CheckoutPhoneValidation =
  | { ok: true; phone: string }
  | { ok: false; message: string };

export function normalizeCheckoutPhone(raw: string): string {
  let digits = String(raw ?? "").replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    digits = `55${digits}`;
  }

  return digits;
}

export function validateCheckoutPhone(raw: string): CheckoutPhoneValidation {
  const phone = normalizeCheckoutPhone(raw);

  if (!phone) {
    return { ok: false, message: "Telefone / WhatsApp é obrigatório." };
  }

  if (phone.length < 10 || phone.length > 15) {
    return {
      ok: false,
      message: "Informe um telefone válido com DDD. Exemplo: (62) 99999-9999.",
    };
  }

  return { ok: true, phone };
}
