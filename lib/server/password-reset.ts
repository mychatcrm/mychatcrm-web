/**
 * Password recovery service.
 *
 * Admin continua com tokens de uso único. Clientes recebem uma senha temporária
 * gerada pelo sistema e enviada por e-mail, conforme fluxo comercial atual.
 *
 * A lógica sensível de banco é delegada a RPCs SECURITY DEFINER:
 *   • request_password_reset_token — lookup do utilizador + gestão do token (atómico)
 *   • consume_password_reset_token — validação + update de senha + mark used (atómico, FOR UPDATE)
 *   • set_member_temporary_password — troca atómica da senha do membro por e-mail
 *
 * Isso elimina (1) dependência de bypass RLS via chave legada, e (2) a janela de
 * replay entre validação e marcação de used_at que existia na implementação anterior.
 */
import { createHash, randomBytes } from "crypto";
import { SITE_URL } from "@/lib/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isForgotPasswordForensicEnabled } from "@/lib/server/forgot-password-forensics";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";
import { isResendConfigured, isResendTestSender } from "@/lib/server/resend-config";
import { validatePassword } from "@/lib/password-policy";

const TOKEN_BYTES = 32;
const EXPIRY_MINUTES = 30;
const TEMP_PASSWORD_BYTES = 9;

export type PasswordResetScope = "admin" | "member";

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function resetLink(rawToken: string, baseOverride?: string): string {
  let base = (baseOverride?.trim() || SITE_URL).replace(/\/$/, "");
  try {
    const u = new URL(base);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      base = SITE_URL.replace(/\/$/, "");
    }
  } catch {
    base = SITE_URL.replace(/\/$/, "");
  }
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

function generateTemporaryPassword(): string {
  const base = randomBytes(TEMP_PASSWORD_BYTES).toString("base64url");
  return `${base}Aa1!`;
}

/** Masks email for safe logging: ana@empresa.com → a**@e*****.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal = local[0] + "**";
  const [domainName, ...ext] = domain.split(".");
  const maskedDomain = domainName[0] + "*".repeat(Math.max(0, domainName.length - 1));
  return `${maskedLocal}@${maskedDomain}.${ext.join(".")}`;
}

export async function requestPasswordReset(params: {
  emailRaw: string;
  scope: PasswordResetScope;
  /** Ex.: origem do POST (https://…vercel.app ou domínio próprio). Opcional: cai em SITE_URL. */
  linkBaseUrl?: string;
}): Promise<{ sent: boolean; mailConfigured: boolean }> {
  const email = params.emailRaw.trim().toLowerCase();
  const mailConfigured = isResendConfigured();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Invalid format: still report whether Resend is configured (avoids misleading 503 when key is set).
    return { sent: false, mailConfigured };
  }

  if (params.scope === "member") {
    return requestMemberTemporaryPassword({ email, mailConfigured });
  }

  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000).toISOString();

  const sb = createSupabaseServiceClient();

  // Single atomic RPC: resolves user, deletes old tokens, inserts new token.
  // Returns {found: false} for unknown/inactive accounts — we treat both paths identically.
  const { data: rpcResult, error: rpcErr } = await sb.rpc("request_password_reset_token", {
    p_email: email,
    p_scope: params.scope,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (rpcErr) {
    console.error("[password-reset] request_password_reset_token RPC:", rpcErr.message);
    if (isForgotPasswordForensicEnabled()) {
      console.warn("[password-reset] stage", JSON.stringify({ stage: "rpc_error", scope: params.scope }));
    }
    return { sent: false, mailConfigured };
  }

  const result = rpcResult as { found: boolean } | null;
  if (!result?.found) {
    if (isForgotPasswordForensicEnabled()) {
      console.warn("[password-reset] stage", JSON.stringify({ stage: "account_not_found", scope: params.scope }));
    }
    // Account not found — return silently to avoid enumeration; caller sends generic message.
    return { sent: false, mailConfigured };
  }

  if (isForgotPasswordForensicEnabled()) {
    console.warn("[password-reset] stage", JSON.stringify({ stage: "before_resend_send", scope: params.scope }));
  }

  // Token inserted; send email.
  const link = resetLink(rawToken, params.linkBaseUrl);
  const subject =
    params.scope === "admin"
      ? "Redefinição de senha — painel administrativo MyChatCRM"
      : "Redefinição de senha — MyChatCRM";

  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#111827">
  <h2 style="font-size:20px;font-weight:600;margin-bottom:16px">Redefinição de palavra-passe</h2>
  <p>Recebemos um pedido para redefinir a palavra-passe associada a esta conta.</p>
  <p style="margin:24px 0">
    <a href="${link}" style="display:inline-block;padding:12px 20px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-weight:500">
      Redefinir palavra-passe
    </a>
  </p>
  <p style="font-size:13px;color:#6b7280">Ou copie e cole no navegador:</p>
  <p style="word-break:break-all;font-size:12px;color:#374151;background:#f3f4f6;padding:8px 12px;border-radius:6px">${link}</p>
  <p style="font-size:13px;color:#6b7280;margin-top:24px">
    Este link expira em ${EXPIRY_MINUTES} minutos e só pode ser usado uma vez.<br>
    Se não foi você, ignore este e-mail — a sua palavra-passe não foi alterada.
  </p>
</div>
`.trim();

  const text = `Redefinição de palavra-passe MyChatCRM\n\nAbra o link (válido ${EXPIRY_MINUTES} minutos, uso único):\n${link}\n\nSe não foi você, ignore este e-mail.`;

  const mail = await sendTransactionalEmail({ to: email, subject, html, text });
  if (!mail.ok) {
    console.error(
      "[password-reset] Resend failed for",
      maskEmail(email),
      "scope:", params.scope,
      "code:", "detail" in mail ? mail.detail : mail.code,
    );
    if (isForgotPasswordForensicEnabled()) {
      console.warn(
        "[password-reset] stage",
        JSON.stringify({
          stage: "resend_http_failed",
          scope: params.scope,
          resendCode: mail.code,
          resendDetail: "detail" in mail ? mail.detail : undefined,
        }),
      );
    }
    // Roll back: remove the token so the window doesn't linger without email delivered.
    await sb.from("password_reset_tokens").delete().eq("token_hash", tokenHash);
    return { sent: false, mailConfigured };
  }

  if (isForgotPasswordForensicEnabled()) {
    console.warn("[password-reset] stage", JSON.stringify({ stage: "resend_ok", scope: params.scope }));
  }

  return { sent: true, mailConfigured: true };
}

async function requestMemberTemporaryPassword(params: {
  email: string;
  mailConfigured: boolean;
}): Promise<{ sent: boolean; mailConfigured: boolean }> {
  const { email, mailConfigured } = params;

  if (!mailConfigured) {
    return { sent: false, mailConfigured: false };
  }

  if (isResendTestSender()) {
    console.error(
      "[password-reset] member temporary password blocked: Resend sender is still using @resend.dev test mode. Verify a domain in Resend and set RESEND_FROM_EMAIL to that domain before changing member passwords.",
    );
    if (isForgotPasswordForensicEnabled()) {
      console.warn("[password-reset] stage", JSON.stringify({ stage: "member_temp_password_test_sender_blocked" }));
    }
    return { sent: false, mailConfigured };
  }

  const temporaryPassword = generateTemporaryPassword();
  const sb = createSupabaseServiceClient();

  const { data: rpcResult, error: rpcErr } = await sb.rpc("set_member_temporary_password", {
    p_email: email,
    p_new_password: temporaryPassword,
  });

  if (rpcErr) {
    console.error("[password-reset] set_member_temporary_password RPC:", rpcErr.message);
    if (isForgotPasswordForensicEnabled()) {
      console.warn("[password-reset] stage", JSON.stringify({ stage: "member_temp_password_rpc_error" }));
    }
    return { sent: false, mailConfigured };
  }

  const result = rpcResult as { found?: boolean; code?: string } | null;
  if (!result?.found) {
    if (isForgotPasswordForensicEnabled()) {
      console.warn("[password-reset] stage", JSON.stringify({ stage: "member_account_not_found" }));
    }
    return { sent: false, mailConfigured };
  }

  const loginUrl = `${SITE_URL.replace(/\/$/, "")}/login`;
  const subject = "Nova senha temporária — MyChatCRM";
  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111827">
  <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Nova senha temporária</h2>
  <p>Recebemos um pedido para recuperar o acesso à sua conta MyChatCRM.</p>
  <p>Use a senha temporária abaixo para entrar no painel:</p>
  <p style="font-size:22px;letter-spacing:1px;font-weight:700;background:#f3f4f6;border-radius:10px;padding:14px 16px;margin:20px 0;color:#111827">${temporaryPassword}</p>
  <p style="margin:24px 0">
    <a href="${loginUrl}" style="display:inline-block;padding:12px 20px;background:#f24400;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
      Entrar no MyChatCRM
    </a>
  </p>
  <p style="font-size:13px;color:#6b7280;line-height:1.5">
    Por segurança, recomendamos trocar esta senha em Configurações depois de entrar.
    Se não foi você, entre em contato com o suporte.
  </p>
</div>
`.trim();

  const text = `Nova senha temporária MyChatCRM\n\nUse esta senha para entrar no painel: ${temporaryPassword}\n\nLogin: ${loginUrl}\n\nPor segurança, recomendamos trocar esta senha em Configurações depois de entrar. Se não foi você, entre em contato com o suporte.`;

  const mail = await sendTransactionalEmail({ to: email, subject, html, text });
  if (!mail.ok) {
    console.error(
      "[password-reset] CRITICAL temporary password updated but email failed for",
      maskEmail(email),
      "code:",
      "detail" in mail ? mail.detail : mail.code,
    );
    if (isForgotPasswordForensicEnabled()) {
      console.warn(
        "[password-reset] stage",
        JSON.stringify({
          stage: "member_temp_password_email_failed",
          resendCode: mail.code,
          resendDetail: "detail" in mail ? mail.detail : undefined,
        }),
      );
    }
    return { sent: false, mailConfigured };
  }

  if (isForgotPasswordForensicEnabled()) {
    console.warn("[password-reset] stage", JSON.stringify({ stage: "member_temp_password_email_ok" }));
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
  const raw = params.rawToken.trim();
  if (!raw || raw.length < 16) {
    return { ok: false, code: "invalid_token" };
  }

  // Delegate client-visible validation to shared policy.
  const pwCheck = validatePassword(params.newPassword);
  if (!pwCheck.valid) {
    return { ok: false, code: "weak_password" };
  }

  const tokenHash = hashPasswordResetToken(raw);
  const sb = createSupabaseServiceClient();

  // Single atomic RPC: FOR UPDATE lock, validation, password update, mark used.
  const { data: rpcResult, error: rpcErr } = await sb.rpc("consume_password_reset_token", {
    p_token_hash: tokenHash,
    p_new_password: params.newPassword.trim(),
  });

  if (rpcErr) {
    console.error("[password-reset] consume_password_reset_token RPC:", rpcErr.message);
    return { ok: false, code: "db_error" };
  }

  const res = rpcResult as { code: string } | null;
  const code = res?.code ?? "invalid_token";

  if (code === "ok") return { ok: true };
  if (code === "expired") return { ok: false, code: "expired" };
  if (code === "already_used") return { ok: false, code: "already_used" };
  if (code === "weak_password") return { ok: false, code: "weak_password" };
  return { ok: false, code: "invalid_token" };
}
