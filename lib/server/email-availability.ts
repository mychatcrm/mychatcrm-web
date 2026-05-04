/**
 * Verificação de disponibilidade de e-mail — fonte única de verdade.
 *
 * Ordem de tentativa (robustez):
 * 1) RPC `tenant_member_email_exists` no Postgres (SECURITY DEFINER) — evita falhas de PostgREST com count+head
 * 2) REST count exact + head
 * 3) REST select id limit 1
 *
 * Política na rota Stripe: fail-CLOSED (ok:false → não abre Checkout).
 * A rota só de UX pode ser fail-open (ver app/api/checkout/email-availability).
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

    // 1) RPC — caminho preferido (criada na migration tenant_member_email_exists)
    const { data: existsRpc, error: rpcErr } = await sb.rpc("tenant_member_email_exists", {
      p_email: email,
    });

    if (!rpcErr && typeof existsRpc === "boolean") {
      return { ok: true, available: !existsRpc };
    }

    if (rpcErr) {
      console.warn("[email-availability] RPC falhou, fallback REST:", rpcErr.code, rpcErr.message);
    }

    // 2) Count + head
    const { count, error: countErr } = await sb
      .from("tenant_members")
      .select("*", { count: "exact", head: true })
      .eq("email", email);

    if (!countErr) {
      return { ok: true, available: (count ?? 0) === 0 };
    }

    console.warn("[email-availability] count REST falhou, fallback limit 1:", countErr.message);

    // 3) Uma linha
    const { data: rows, error: rowErr } = await sb
      .from("tenant_members")
      .select("id")
      .eq("email", email)
      .limit(1);

    if (rowErr) {
      console.error("[email-availability] Supabase error final:", rowErr.code, rowErr.message);
      return { ok: false, reason: "supabase_error", message: rowErr.message };
    }

    return { ok: true, available: !rows?.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email-availability] Unexpected error:", message);
    return { ok: false, reason: "supabase_error", message };
  }
}
