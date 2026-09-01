import { NextResponse } from "next/server";
import {
  boundedWatchdogReasonCodes,
  sendWatchdogEmailNotification,
  type WatchdogMode,
  type WatchdogNotificationKind,
} from "@/lib/server/agent-runtime-watchdog-notifications";

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

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" && KINDS.has(body.kind)
    ? body.kind as WatchdogNotificationKind
    : null;
  const mode = (typeof body.mode === "string" && MODES.has(body.mode) ? body.mode : "live") as WatchdogMode;
  if (!kind) {
    return NextResponse.json({ ok: false, code: "invalid_kind" }, { status: 400 });
  }

  const sent = await sendWatchdogEmailNotification({
    kind,
    mode,
    reasons: boundedWatchdogReasonCodes(body.reasons),
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
      { ok: false, code: sent.code, detail: sent.detail ?? null },
      { status: sent.code === "owner_email_missing" ? 503 : 502, headers: { "Cache-Control": "no-store" } },
    );
}
