export type LeadOutreachDecision = {
  shouldSend: boolean;
  reason: "not_sent_yet" | "same_leadgen_already_sent" | "initial_outreach_already_sent";
};

function textField(fields: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = fields[key]?.trim();
    if (value) return value;
  }
  return "";
}

/** Strips formatting from a phone string and ensures E.164-ish format with country code. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const stripped = digits.startsWith("0") ? digits.slice(1) : digits;
  if (stripped.length >= 10 && stripped.length <= 11 && !stripped.startsWith("55")) {
    return `55${stripped}`;
  }
  return stripped;
}

export function extractLeadPhone(fields: Record<string, string>): string {
  return normalizePhone(
    textField(fields, [
      "phone_number",
      "phone",
      "telefone",
      "whatsapp",
      "celular",
      "mobile",
      "numero",
      "número",
    ]),
  );
}

export function extractLeadName(fields: Record<string, string>): string {
  const full = textField(fields, ["full_name", "nome_completo", "name", "nome"]);
  if (full) return full;
  const firstName = textField(fields, ["first_name", "primeiro_nome"]);
  const lastName = textField(fields, ["last_name", "sobrenome", "ultimo_nome", "último_nome"]);
  return [firstName, lastName].filter(Boolean).join(" ") || "Lead";
}

export function buildWhatsappRemoteJid(phone: string): string {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

export function shouldSendMetaInitialOutreach(metadata: unknown, leadgenId: string): LeadOutreachDecision {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
  const sentLeadgenId = typeof meta.meta_initial_outreach_leadgen_id === "string"
    ? meta.meta_initial_outreach_leadgen_id.trim()
    : "";
  if (sentLeadgenId && sentLeadgenId === leadgenId) {
    return { shouldSend: false, reason: "same_leadgen_already_sent" };
  }
  const sentAt = typeof meta.meta_initial_outreach_sent_at === "string"
    ? meta.meta_initial_outreach_sent_at.trim()
    : "";
  if (sentAt) {
    return { shouldSend: false, reason: "initial_outreach_already_sent" };
  }
  return { shouldSend: true, reason: "not_sent_yet" };
}
