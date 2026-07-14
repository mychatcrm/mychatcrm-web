import { createHash, randomInt } from "crypto";
import { validateCheckoutPhone } from "@/lib/checkout-phone";
import { sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type AccountPhoneVerificationType = "personal" | "system_notification" | "appointment_notification";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const CODE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;

type VerificationRow = {
  id: string;
  phone: string;
  code_hash: string;
  attempts: number | null;
  expires_at: string;
  status: string;
};

function getPhoneVerificationPepper(): string {
  const pepper =
    process.env.PHONE_VERIFICATION_PEPPER?.trim() ||
    process.env.PASSWORD_PEPPER?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!pepper && process.env.NODE_ENV === "production") {
    throw new Error("[account-phone-verification] PHONE_VERIFICATION_PEPPER não configurado.");
  }

  return pepper || "mychatcrm-phone-verification-test-pepper";
}

export function hashPhoneVerificationCode(params: {
  tenantId: string;
  memberId: string | null;
  phoneType: AccountPhoneVerificationType;
  phone: string;
  code: string;
}): string {
  return createHash("sha256")
    .update(
      [
        getPhoneVerificationPepper(),
        params.tenantId,
        params.memberId ?? "tenant",
        params.phoneType,
        params.phone,
        params.code,
      ].join(":"),
    )
    .digest("hex");
}

export function generatePhoneVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function safeLast4(phone: string): string {
  return phone.slice(-4);
}

function buildVerificationMessage(code: string): string {
  return [
    `Código MyChatCRM: ${code}.`,
    "Use este código em Configurações para confirmar seu telefone.",
    "A mensagem pode vir de um número diferente do seu WhatsApp comercial — verifique também Solicitações.",
    "Ele expira em 10 minutos. Se você não solicitou, ignore.",
  ].join("\n");
}

export async function requestAccountPhoneVerification(params: {
  tenantId: string;
  memberId: string | null;
  phoneType: AccountPhoneVerificationType;
  rawPhone: string;
  requestedByEmail: string;
  sb?: SupabaseServiceClient;
  send?: typeof sendSystemNotification;
}): Promise<{ ok: true; phone: string; expiresAt: string } | { ok: false; error: string; status?: number }> {
  const validation = validateCheckoutPhone(params.rawPhone);
  if (!validation.ok) return { ok: false, error: validation.message, status: 400 };

  const sb = params.sb ?? createSupabaseServiceClient();
  const phone = validation.phone;
  const recentSince = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const { count, error: countError } = await sb
    .from("account_phone_verification_codes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .eq("phone_type", params.phoneType)
    .eq("phone", phone)
    .gte("created_at", recentSince)
    .in("status", ["pending", "sent"]);

  if (countError) {
    console.error("[account-phone-verification] rate_limit_count_failed", countError.message);
    return { ok: false, error: "Não foi possível preparar a verificação do telefone.", status: 500 };
  }

  if ((count ?? 0) >= MAX_SENDS_PER_WINDOW) {
    return {
      ok: false,
      error: "Muitos códigos enviados para este telefone. Aguarde alguns minutos antes de tentar novamente.",
      status: 429,
    };
  }

  await sb
    .from("account_phone_verification_codes")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .eq("phone_type", params.phoneType)
    .in("status", ["pending", "sent"]);

  const code = generatePhoneVerificationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const codeHash = hashPhoneVerificationCode({
    tenantId: params.tenantId,
    memberId: params.memberId,
    phoneType: params.phoneType,
    phone,
    code,
  });

  const { data: inserted, error: insertError } = await sb
    .from("account_phone_verification_codes")
    .insert({
      tenant_id: params.tenantId,
      member_id: params.memberId,
      phone_type: params.phoneType,
      phone,
      code_hash: codeHash,
      status: "pending",
      expires_at: expiresAt,
      metadata: {
        requested_by_email: params.requestedByEmail,
        phone_last4: safeLast4(phone),
      },
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    console.error("[account-phone-verification] insert_failed", insertError?.message);
    return { ok: false, error: "Não foi possível criar o código de verificação.", status: 500 };
  }

  const sender = params.send ?? sendSystemNotification;
  const send = await sender(phone, buildVerificationMessage(code), "", {
    type: "phone_verification_code",
    metadata: {
      tenant_id: params.tenantId,
      member_id: params.memberId,
      phone_type: params.phoneType,
      phone_last4: safeLast4(phone),
    },
  });

  if (!send.ok) {
    await sb
      .from("account_phone_verification_codes")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        metadata: {
          requested_by_email: params.requestedByEmail,
          phone_last4: safeLast4(phone),
          send_error: send.error ?? "send_failed",
        },
      })
      .eq("id", inserted.id);
    return {
      ok: false,
      error: "Não foi possível enviar o código pelo agente do sistema. Verifique a conexão do agente e tente novamente.",
      status: 502,
    };
  }

  const { error: sentError } = await sb
    .from("account_phone_verification_codes")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", inserted.id);

  if (sentError) {
    console.error("[account-phone-verification] mark_sent_failed", sentError.message);
  }

  return { ok: true, phone, expiresAt };
}

export async function confirmAccountPhoneVerification(params: {
  tenantId: string;
  memberId: string | null;
  phoneType: AccountPhoneVerificationType;
  code: string;
  sb?: SupabaseServiceClient;
  applyVerifiedPhone: (phone: string) => Promise<void>;
}): Promise<{ ok: true; phone: string } | { ok: false; error: string; status?: number }> {
  const cleanCode = String(params.code ?? "").replace(/\D/g, "");
  if (cleanCode.length !== 6) {
    return { ok: false, error: "Digite o código de 6 dígitos enviado para o telefone.", status: 400 };
  }

  const sb = params.sb ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("account_phone_verification_codes")
    .select("id, phone, code_hash, attempts, expires_at, status")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .eq("phone_type", params.phoneType)
    .eq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[account-phone-verification] lookup_failed", error.message);
    return { ok: false, error: "Não foi possível validar o código.", status: 500 };
  }

  const row = data as VerificationRow | null;
  if (!row) {
    return { ok: false, error: "Código inválido ou expirado. Solicite um novo código.", status: 400 };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sb
      .from("account_phone_verification_codes")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return { ok: false, error: "Código expirado. Solicite um novo código.", status: 400 };
  }

  const expected = hashPhoneVerificationCode({
    tenantId: params.tenantId,
    memberId: params.memberId,
    phoneType: params.phoneType,
    phone: row.phone,
    code: cleanCode,
  });

  if (expected !== row.code_hash) {
    const attempts = (row.attempts ?? 0) + 1;
    await sb
      .from("account_phone_verification_codes")
      .update({
        attempts,
        status: attempts >= MAX_ATTEMPTS ? "locked" : "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return {
      ok: false,
      error: attempts >= MAX_ATTEMPTS ? "Muitas tentativas incorretas. Solicite um novo código." : "Código incorreto.",
      status: 400,
    };
  }

  try {
    await params.applyVerifiedPhone(row.phone);
  } catch (applyError) {
    console.error("[account-phone-verification] apply_failed", applyError instanceof Error ? applyError.message : "apply_failed");
    return { ok: false, error: "Código correto, mas não foi possível salvar o telefone. Tente novamente.", status: 500 };
  }

  const { error: consumeError } = await sb
    .from("account_phone_verification_codes")
    .update({
      status: "consumed",
      consumed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (consumeError) {
    console.warn("[account-phone-verification] consume_failed", consumeError.message);
  }

  return { ok: true, phone: row.phone };
}
