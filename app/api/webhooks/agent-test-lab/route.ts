import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { labSecretMatches } from "@/lib/server/agent-test-lab/auth";
import { LAB_INSTANCE_PREFIX, LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { acceptsLabInbound } from "@/lib/agent-test-lab/webhook-policy";
import { extractInboundMessagesFromEvolutionPayload, normalizeEvolutionEventName } from "@/lib/integrations/evolution-webhook-parse";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error("body_missing");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 512 * 1024) { await reader.cancel(); throw new Error("body_too_large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_body");
  return body;
}
export async function POST(request: Request) {
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true") return NextResponse.json({ ok: false }, { status: 503 });
  try {
    const url = new URL(request.url), id = assertLabUuid(url.searchParams.get("connection") ?? ""), token = url.searchParams.get("token") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ ok: false }, { status: 401 });
    const sb = createSupabaseServiceClient();
    const connection = await sb.from("agent_test_lab_connections").select("id,instance_name,webhook_secret_hash")
      .eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "sender").is("archived_at", null).maybeSingle();
    if (connection.error) return NextResponse.json({ ok: false }, { status: 503 });
    if (!connection.data || !connection.data.instance_name.startsWith(LAB_INSTANCE_PREFIX) || !labSecretMatches(token, connection.data.webhook_secret_hash)) return NextResponse.json({ ok: false }, { status: 401 });
    const body = await boundedJson(request);
    if (body.instance !== connection.data.instance_name) return NextResponse.json({ ok: false }, { status: 403 });
    if (normalizeEvolutionEventName(body.event) !== "MESSAGES_UPSERT") return NextResponse.json({ ok: true, ignored: true });
    const run = await sb.from("agent_test_lab_runs").select("id,trace_id,target_jid,target_tenant_id,target_connection_id,target_channel,created_at,deadline_at")
      .eq("sender_connection_id", id).in("status", ["running", "paused", "waiting_reply", "waiting_input"]).maybeSingle();
    if (run.error) return NextResponse.json({ ok: false }, { status: 503 });
    if (!run.data) return NextResponse.json({ ok: true, ignored: true });
    const active = run.data;
    const destination = await sb.from("agent_test_lab_destinations").select("id").eq("owner_admin_id", LAB_OWNER_ID)
      .eq("tenant_id", active.target_tenant_id).eq("connection_id", active.target_connection_id)
      .eq("channel", active.target_channel).eq("target_jid", active.target_jid).is("revoked_at", null).maybeSingle();
    if (destination.error) return NextResponse.json({ ok: false }, { status: 503 });
    if (!destination.data) return NextResponse.json({ ok: true, ignored: true });
    let accepted = 0;
    for (const message of extractInboundMessagesFromEvolutionPayload(body)) {
      if (!message.messageId || !acceptsLabInbound({ fromMe: message.fromMe, providerTime: message.occurredAt, remoteJid: message.remoteJid,
        targetJid: active.target_jid ?? "", runCreatedAt: active.created_at, deadlineAt: active.deadline_at, now: Date.now() })) continue;
      const content = message.type === "text" ? message.text : "caption" in message ? message.caption : null;
      const saved = await sb.from("agent_test_lab_messages").upsert({ run_id: active.id, direction: "agent", kind: message.type,
        content: content?.slice(0, 20000) ?? null, provider_message_id: message.messageId,
        provider_occurred_at: message.occurredAt }, { onConflict: "run_id,direction,provider_message_id", ignoreDuplicates: true }).select("id");
      if (saved.error) return NextResponse.json({ ok: false }, { status: 503 });
      accepted += saved.data?.length ?? 0;
    }
    if (accepted) await appendOperationalAuditEvent({ traceId: active.trace_id, actorType: "webhook", module: "agent.test_lab", action: "inbound.persisted",
      status: "completed", resourceType: "agent_test_lab_run", resourceId: active.id, relatedIds: { runId: active.id }, metadata: { count: accepted } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
}
