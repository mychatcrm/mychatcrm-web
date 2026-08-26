/**
 * Verificação de disponibilidade de e-mail — fonte única de verdade.
 *
 * Ordem de tentativa (robustez):
 * 1) RPC `tenant_member_email_exists` via service client (SECURITY DEFINER, bypass RLS)
 * 2) REST count exact + head (via service client, se disponível)
 * 3) REST select id limit 1 (via service client, se disponível)
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
  | { ok: false; reason: "supabase_error"; message: string; envMissing?: boolean };

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

  // ---- 1) Tentar com service client (bypass RLS, mais seguro) ----
  let sb: ReturnType<typeof createSupabaseServiceClient> | null = null;
  let envMissing = false;

  try {
    sb = createSupabaseServiceClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    envMissing = msg.includes("não definida") || msg.includes("env");
    console.warn("[email-availability] Service client indisponível:", msg);
  }

  if (sb) {
    // 1a) RPC — caminho preferido
    const { data: existsRpc, error: rpcErr } = await sb.rpc("tenant_member_email_exists", {
      p_email: email,
    });

    if (!rpcErr && typeof existsRpc === "boolean") {
      return { ok: true, available: !existsRpc };
    }

    if (rpcErr) {
      console.warn("[email-availability] RPC (service) falhou, fallback REST:", rpcErr.code, rpcErr.message);
    }

    // 1b) Count + head
    const { count, error: countErr } = await sb
      .from("tenant_members")
      .select("*", { count: "exact", head: true })
      .eq("email", email);

    if (!countErr) {
      return { ok: true, available: (count ?? 0) === 0 };
    }

    console.warn("[email-availability] count REST falhou, fallback limit 1:", countErr.message);

    // 1c) Uma linha
    const { data: rows, error: rowErr } = await sb
      .from("tenant_members")
      .select("id")
      .eq("email", email)
      .limit(1);

    if (!rowErr) {
      return { ok: true, available: !rows?.length };
    }

    console.warn("[email-availability] Todos os métodos service falharam:", rowErr.message);
  }

  // Nunca consulta existência de contas com a chave pública. Sem service_role a
  // verificação falha fechada; expor esta RPC permitiria enumeração de usuários.
  return {
    ok: false,
    reason: "supabase_error",
    message: envMissing ? "service_role_unavailable" : "email_availability_check_failed",
    envMissing,
  };
}
