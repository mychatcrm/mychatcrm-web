import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { LAB_MESSAGE_RESERVE_BRL } from "@/lib/agent-test-lab/contracts";
import { startLabRunProcessing } from "@/lib/server/agent-test-lab/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: { id: string } };

/** The conversation as the laboratory can prove it: both directions, in order. */
export async function GET(request: Request, { params }: Context) {
  try {
    await requireLabOwner(request);
    const id = assertLabUuid(params.id), sb = createSupabaseServiceClient();
    const run = await sb.from("agent_test_lab_runs").select("id").eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
    if (run.error || !run.data) throw new Error("run_missing");
    const messages = await sb.from("agent_test_lab_messages")
      .select("direction,kind,content,provider_message_id,provider_occurred_at,received_at")
      .eq("run_id", id).order("received_at").limit(2000);
    if (messages.error) throw new Error("messages_read_failed");
    return NextResponse.json({ messages: messages.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}

/**
 * Queues one tester message. Limits, budget and the authorized destination are
 * checked inside the same transaction that creates the step, so nothing can be
 * sent by a request that merely looked valid when it arrived.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const owner = await requireLabOwner(request);
    const id = assertLabUuid(params.id);
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const assetId = typeof body.assetId === "string" && body.assetId ? assertLabUuid(body.assetId) : null;
    // An attachment may travel with or without a caption, but a plain message needs text.
    if (!assetId && (!text || text.length > 4000)) throw new Error("invalid_message");
    if (text.length > 4000) throw new Error("invalid_message");
    const key = typeof body.idempotencyKey === "string" && /^[A-Za-z0-9_:-]{8,120}$/.test(body.idempotencyKey)
      ? body.idempotencyKey : `lab-msg:${id}:${Date.now()}`;

    const sb = createSupabaseServiceClient();
    const run = await sb.from("agent_test_lab_runs").select("mode").eq("id", id).eq("owner_admin_id", LAB_OWNER_ID).single();
    if (run.error || !run.data) throw new Error("run_missing");

    const queued = await sb.rpc("enqueue_agent_test_lab_step_v1", {
      p_run_id: id, p_owner: owner.adminId, p_kind: assetId ? "media" : "text",
      p_command: assetId ? { text, assetId } : { text }, p_key: key, p_reserve: LAB_MESSAGE_RESERVE_BRL,
    });
    if (queued.error) throw new Error("message_queue_failed");
    if (queued.data?.ok !== true) {
      return NextResponse.json({ ok: false, code: queued.data?.code ?? "message_rejected" },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    await labAudit("run.tester_message_queued", id);
    waitUntil(startLabRunProcessing(id, String(run.data.mode)));
    return NextResponse.json({ ok: true, ...queued.data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
