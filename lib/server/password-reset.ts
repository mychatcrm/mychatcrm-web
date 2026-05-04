/**
 * Recuperação de senha — tokens de uso único, hash SHA-256 no Postgres.
 * Escopos: admin (admin_users) | member (tenant_members).
 */
import { createHash, randomBytes } from "crypto";
import { SITE_URL } from "@/lib/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";

const TOKEN_BYTES = 32;
/** Janela curta para reduzir risco se o link vazar. */
const EXPIRY_MINUTES = 45;

export type PasswordResetScope = "admin" | "member";

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function resetLink(rawToken: string): string {
  const base = SITE_URL.replace(/\/$/, "");
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export async function requestPasswordReset(params: {
  emailRaw: string;
  scope: PasswordResetScope;
}): Promise<{ sent: boolean; mailConfigured: boolean }> {
  const email = params.emailRaw.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, mailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()) };
  }

  const sb = createSupabaseServiceClient();

  let subjectId: string | null = null;
  if (params.scope === "admin") {
    const { data } = await sb
      .from("admin_users")
      .select("id")
      .eq("email", email)
      .eq("active", true)
      .maybeSingle();
    subjectId = data?.id ?? null;
  } else {
    const { data } = await sb
      .from("tenant_members")
      .select("id")
      .eq("email", email)
      .eq("ativo", true)
      .eq("account_suspended", false)
      .maybeSingle();
    subjectId = data?.id ?? null;
  }

  if (!subjectId) {
    return { sent: false, mailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()) };
  }

  await sb
    .from("password_reset_tokens")
    .delete()
    .eq("email", email)
    .eq("scope", params.scope)
    .is("used_at", null);

  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { data: inserted, error: insErr } = await sb
    .from("password_reset_tokens")
    .insert({
      token_hash: tokenHash,
      scope: params.scope,
      subject_id: subjectId,
      email,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insErr || !inserted?.id) {
    console.error("[password-reset] insert token:", insErr?.message);
    return { sent: false, mailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()) };
  }

  const link = resetLink(rawToken);
  const subject =
    params.scope === "admin"
      ? "Redefinição de senha — painel administrativo MyChatCRM"
      : "Redefinição de senha — MyChatCRM";

  const html = `
<p>Recebemos um pedido para redefinir a palavra-passe associada a esta conta.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">Redefinir palavra-passe</a></p>
<p>Ou copie e cole no navegador:</p>
<p style="word-break:break-all;font-size:13px;color:#374151">${link}</p>
<p>Este link expira em ${EXPIRY_MINUTES} minutos e só pode ser usado uma vez.</p>
<p>Se não foi você, ignore este e-mail.</p>
`.trim();

  const text = `Redefinição de palavra-passe MyChatCRM\n\nAbra o link (válido ${EXPIRY_MINUTES} minutos, uso único):\n${link}\n`;

  const mail = await sendTransactionalEmail({ to: email, subject, html, text });
  if (!mail.ok) {
    await sb.from("password_reset_tokens").delete().eq("id", inserted.id as string);
    return {
      sent: false,
      mailConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
    };
  }

  return { sent: true, mailConfigured: true };
}

export async function completePasswordReset(params: {
  rawToken: string;
  newPassword: string;
}): Promise<
  | { ok: true }
  | { ok: false; code: "invalid_token" | "expired" | "weak_password" | "db_error" | "already_used" }
> {
  const pwd = params.newPassword.trim();
  if (pwd.length < 8) {
    return { ok: false, code: "weak_password" };
  }

  const raw = params.rawToken.trim();
  if (!raw || raw.length < 16) {
    return { ok: false, code: "invalid_token" };
  }

  const tokenHash = hashPasswordResetToken(raw);
  const sb = createSupabaseServiceClient();

  const { data: row, error } = await sb
    .from("password_reset_tokens")
    .select("id, scope, subject_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, code: "invalid_token" };
  }

  if (row.used_at) {
    return { ok: false, code: "already_used" };
  }

  if (new Date(row.expires_at as string).getTime() <= Date.now()) {
    return { ok: false, code: "expired" };
  }

  if (row.scope === "admin") {
    const { error: pwErr } = await sb.rpc("update_admin_password", {
      p_id: row.subject_id,
      p_new_password: pwd,
    });
    if (pwErr) {
      console.error("[password-reset] update_admin_password:", pwErr.message);
      return { ok: false, code: "db_error" };
    }
  } else {
    const { error: pwErr } = await sb.rpc("update_member_password", {
      p_id: row.subject_id,
      p_new_password: pwd,
    });
    if (pwErr) {
      console.error("[password-reset] update_member_password:", pwErr.message);
      return { ok: false, code: "db_error" };
    }
  }

  const { error: upErr } = await sb
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id);

  if (upErr) {
    console.error("[password-reset] mark used:", upErr.message);
  }

  return { ok: true };
}
