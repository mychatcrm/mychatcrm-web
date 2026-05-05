import { NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST isolado para validar Resend (chave + from) sem fluxo de reset.
 * Só atua se `RESEND_DEBUG_SECRET` estiver definido na Vercel; caso contrário 404.
 * Body JSON: `{ "secret": "<RESEND_DEBUG_SECRET>", "to": "email@destino" }`
 * Após RCA: remover `RESEND_DEBUG_SECRET` e este ficheiro (redeploy).
 */
export async function POST(request: Request) {
  const expected = process.env.RESEND_DEBUG_SECRET?.trim();
  if (!expected) {
    return new NextResponse(null, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { secret?: string; to?: string } | null;
  if (String(body?.secret ?? "") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const to = String(body?.to ?? "").trim().toLowerCase();
  if (!to || !EMAIL_RE.test(to)) {
    return NextResponse.json({ ok: false, error: "invalid_to" }, { status: 400 });
  }

  const mail = await sendTransactionalEmail({
    to,
    subject: "MyChatCRM — Resend ping (debug)",
    html: "<p>Ping transacional OK. Pode ignorar este e-mail.</p>",
    text: "Ping transacional OK. Pode ignorar este e-mail.",
  });

  if (!mail.ok) {
    const detail = "detail" in mail ? mail.detail : undefined;
    console.error(
      "[resend-ping]",
      JSON.stringify({
        ok: false,
        resendCode: mail.code,
        resendDetail: detail,
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        resendCode: mail.code,
        resendDetail: detail,
      },
      { status: 502 },
    );
  }

  console.error("[resend-ping]", JSON.stringify({ ok: true }));
  return NextResponse.json({ ok: true });
}
