const FALLBACK_DIGITS = "5562999999999";

/** Dígitos do número de handoff (sem +), para wa.me e widget. */
export function whatsappHandoffDigits(): string {
  const raw = process.env.NEXT_PUBLIC_WHATSAPP_HANDOFF?.trim() || FALLBACK_DIGITS;
  const digits = raw.replace(/\D/g, "");
  return digits || FALLBACK_DIGITS;
}

/** URL absoluta de handoff comercial. */
export function whatsappHandoffHref(): string {
  return `https://wa.me/${whatsappHandoffDigits()}`;
}
