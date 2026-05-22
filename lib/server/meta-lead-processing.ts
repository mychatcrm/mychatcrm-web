import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type LeadOutreachDecision = {
  shouldSend: boolean;
  reason:
    | "not_sent_yet"
    | "same_leadgen_already_sent"
    | "human_attending_today"
    | "no_agent";
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

/**
 * Idempotência por leadgen_id apenas — telefone repetido em outro formulário pode receber nova mensagem.
 * Bloqueio adicional: mensagem `meta:{leadgen_id}:initial` e atendimento humano ativo no dia (checados no ingest).
 */
export function shouldSendMetaInitialOutreach(_metadata: unknown, leadgenId: string): LeadOutreachDecision {
  const id = leadgenId.trim();
  if (!id) return { shouldSend: false, reason: "same_leadgen_already_sent" };
  return { shouldSend: true, reason: "not_sent_yet" };
}

export function isSameCalendarDayUtc(isoA: string, isoB: string): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

export async function shouldSkipMetaOutreachForHumanAttending(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  now?: Date;
}): Promise<boolean> {
  const { data } = await params.sb
    .from("conversation_states")
    .select("human_paused, paused_at, status")
    .eq("tenant_id", params.tenantId)
    .eq("remote_jid", params.remoteJid)
    .maybeSingle();
  if (!data || data.human_paused !== true) return false;
  const pausedAt = typeof data.paused_at === "string" ? data.paused_at : null;
  if (!pausedAt) return true;
  const nowIso = (params.now ?? new Date()).toISOString();
  return isSameCalendarDayUtc(pausedAt, nowIso);
}
