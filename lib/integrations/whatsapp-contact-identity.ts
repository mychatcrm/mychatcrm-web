const PHONE_JID_SUFFIXES = new Set(["s.whatsapp.net", "c.us"]);

/**
 * Canonical phone identity used for WhatsApp authorization.
 *
 * Only provider-owned phone JIDs (or an already trusted phone value) are
 * accepted. LIDs, groups and arbitrary identifiers fail closed so they can
 * never become agenda ownership keys.
 */
export function normalizeCanonicalWhatsAppPhone(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const [local = "", suffix] = raw.split("@", 2);
  if (suffix && !PHONE_JID_SUFFIXES.has(suffix.toLowerCase())) return null;
  const digits = local.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  // Brazil: 55 + DDD + mobile number without the ninth digit.
  if (digits.startsWith("55") && digits.length === 12) {
    const localNumber = digits.slice(4);
    if (/^[6-9]/.test(localNumber)) return `${digits.slice(0, 4)}9${localNumber}`;
  }

  return digits;
}

export function canonicalWhatsAppJidFromPhone(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

export type CanonicalInboundContact = {
  canonicalPhone: string | null;
  canonicalRemoteJid: string;
  providerRemoteJid: string;
  providerRemoteJidAlt: string | null;
  hasTrustedPhone: boolean;
};

/** Resolves identity exclusively from fields signed by the inbound provider. */
export function resolveCanonicalInboundContact(params: {
  remoteJid: string;
  remoteJidAlt?: string | null;
}): CanonicalInboundContact | null {
  const primary = params.remoteJid.trim();
  const alternate = params.remoteJidAlt?.trim() || null;
  if (!primary || primary.endsWith("@g.us")) return null;

  const primaryPhone = normalizeCanonicalWhatsAppPhone(primary);
  const alternatePhone = normalizeCanonicalWhatsAppPhone(alternate);
  const canonicalPhone = primaryPhone ?? alternatePhone;

  return {
    canonicalPhone,
    canonicalRemoteJid: canonicalPhone ? canonicalWhatsAppJidFromPhone(canonicalPhone) : primary,
    providerRemoteJid: primary,
    providerRemoteJidAlt: alternate,
    hasTrustedPhone: Boolean(canonicalPhone),
  };
}
