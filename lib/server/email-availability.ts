/**
 * Verificação de disponibilidade de e-mail — fonte única de verdade.
 *
 * Política de falha: fail-CLOSED.
 * Se o Supabase devolver error, retorna ok:false — o checkout NUNCA avança.
 * Isso evita cadastros duplicados mesmo em falhas transitórias de rede/env.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailAvailabilityResult =
  | { ok: true; available: true }
  | { ok: true; available: false }
  | { ok: false; reason: "invalid_format" }
  | { ok: false; reason: "supabase_error"; message: string };

/**
 * Verifica se um e-mail está disponível para cadastro.
 * Sempre normaliza para minúsculas antes de consultar.
 * Fail-CLOSED: qualquer falha do Supabase → ok:false (não permite o checkout).
 */
export async function checkEmailAvailability(
  rawEmail: string,
): Promise<EmailAvailabilityResult> {
  const email = rawEmail.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, reason: "invalid_format" };
  }

  try {
    const sb = createSupabaseServiceClient();

    const { count, error } = await sb
      .from("tenant_members")
      .select("id", { count: "exact", head: true })
      .eq("email", email);

    if (error) {
      console.error("[email-availability] Supabase error:", error.code, error.message);
      return {
        ok: false,
        reason: "supabase_error",
        message: error.message,
      };
    }

    return { ok: true, available: (count ?? 0) === 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email-availability] Unexpected error:", message);
    return { ok: false, reason: "supabase_error", message };
  }
}
