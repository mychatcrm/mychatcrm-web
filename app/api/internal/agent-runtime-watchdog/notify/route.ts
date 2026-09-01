import { NextResponse } from "next/server";
import { OPERATIONAL_AUDIT_OWNER_ADMIN_ID } from "@/lib/admin-operational-audit-access";
import { getAdminSessionByIdFromDb } from "@/lib/server/admin-auth-db";
import { sendTransactionalEmail } from "@/lib/server/resend-mail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

const KINDS = new Set(["failure", "repeat", "recovery"]);
const MODES = new Set(["live", "test_failure", "test_repeat", "test_recovery"]);

function authorized(request: Request): boolean {
  const expected = process.env.AGENT_RUNTIME_WATCHDOG_SECRET?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && received && expected.length >= 24 && received === expected);
}

function boundedCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return ["runtime_unhealthy"];
  const codes = value
    .filter((item): item is string => typeof item === "string" && /^[a-z0-9_:-]{1,80}$/i.test(item))
    .slice(0, 10);
  return codes.length ? codes : ["runtime_unhealthy"];
}

function notificationCopy(kind: string, mode: string, reasons: string[]) {
  const testPrefix = mode.startsWith("test_") ? "[TESTE SEGURO — NÃO É INCIDENTE REAL] " : "";
  if (kind === "recovery") {
    return {
      subject: `${testPrefix}MyChatCRM — runtime dos agentes normalizado`,
      text: `${testPrefix}O monitor externo confirmou a recuperação do runtime dos agentes.`,
    };
  }
  const prefix = kind === "repeat" ? "Falha ainda ativa" : "Falha crítica detectada";
  return {
    subject: `${testPrefix}MyChatCRM — ${prefix} no runtime dos agentes`,
    text: `${testPrefix}${prefix}. Códigos técnicos: ${reasons.join(", ")}. Verifique filas, crons e provedores imediatamente.`,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : "live";
  if (!kind) {
    return NextResponse.json({ ok: false, code: "invalid_kind" }, { status: 400 });
  }

  const owner = await getAdminSessionByIdFromDb(OPERATIONAL_AUDIT_OWNER_ADMIN_ID);
  if (!owner?.email) {
    console.error(JSON.stringify({
      scope: "agent-runtime-watchdog-notify",
      event: "owner_email_missing",
    }));
    return NextResponse.json({ ok: false, code: "owner_email_missing" }, { status: 503 });
  }

  const copy = notificationCopy(kind, mode, boundedCodes(body.reasons));
  const sent = await sendTransactionalEmail({
    to: owner.email,
    subject: copy.subject,
    text: copy.text,
    html: `<p>${copy.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`,
  });

  console.log(JSON.stringify({
    scope: "agent-runtime-watchdog-notify",
    event: sent.ok ? "email_sent" : "email_failed",
    kind,
    mode,
    resultCode: sent.ok ? "email_sent" : sent.code,
  }));

  return sent.ok
    ? NextResponse.json({ ok: true, code: "email_sent" }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json(
      { ok: false, code: sent.code, detail: "detail" in sent ? sent.detail ?? null : null },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
}
