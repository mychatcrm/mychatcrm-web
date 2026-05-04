/**
 * Envio transacional via [Resend](https://resend.com) (HTTP, sem SDK extra).
 * Requer RESEND_API_KEY no servidor.
 */

export type SendMailResult = { ok: true } | { ok: false; code: "missing_key" | "http_error"; detail?: string };

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
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
    console.error("[resend-mail] Resend HTTP", res.status, body.slice(0, 500));
    return { ok: false, code: "http_error", detail: `${res.status}` };
  }

  return { ok: true };
}
