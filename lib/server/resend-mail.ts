/**
 * Envio transacional via [Resend](https://resend.com) (HTTP, sem SDK extra).
 * Requer RESEND_API_KEY no servidor.
 *
 * Produção: verificar domínio do remetente em Resend → Domains (SPF/DKIM).
 * `RESEND_FROM_EMAIL` deve usar um endereço desse domínio ou, em testes,
 * `MyChatCRM <onboarding@resend.dev>`.
 */

import { getResendApiKey } from "@/lib/server/resend-config";

export type SendMailResult = { ok: true } | { ok: false; code: "missing_key" | "http_error"; detail?: string };

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendMailResult> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    console.error("[resend-mail] RESEND_API_KEY não definida — e-mail não enviado.");
    return { ok: false, code: "missing_key" };
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() || "MyChatCRM <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      "[resend-mail] Resend API error",
      JSON.stringify({
        httpStatus: res.status,
        snippet: body.slice(0, 500),
        hint:
          res.status === 403 || res.status === 422
            ? "Verifique RESEND_FROM_EMAIL e domínio verificado no painel Resend."
            : undefined,
      }),
    );
    return { ok: false, code: "http_error", detail: `${res.status}` };
  }

  return { ok: true };
}
