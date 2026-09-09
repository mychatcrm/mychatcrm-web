import { NextResponse } from "next/server";
import { unlockLab, requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_COOKIE } from "@/lib/agent-test-lab/contracts";
export const dynamic = "force-dynamic";
// operational-audit: reconciled — labAudit records session unlock/revoke before mutation.
export async function POST(request: Request) {
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true") return labError(new Error("lab_disabled"));
  const rate = checkInMemoryRateLimit(`lab-unlock:${getClientIpFromRequest(request) || "unknown"}`, 5, 15 * 60000);
  if (!rate.ok) return NextResponse.json({ code: "rate_limited" }, { status: 429 });
  try { return await unlockLab(request); } catch (error) { return labError(error); }
}
export async function GET(request: Request) {
  try { await requireLabOwner(request); return NextResponse.json({ unlocked: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return labError(error); }
}
export async function DELETE(request: Request) {
  try {
    const owner = await requireLabOwner(request);
    await labAudit("session.revoked");
    const { error } = await createSupabaseServiceClient().from("agent_test_lab_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", owner.tokenHash);
    if (error) throw new Error("session_revoke_failed");
    const response = NextResponse.json({ ok: true }); response.cookies.set(LAB_COOKIE, "", { path: "/", maxAge: 0 }); return response;
  } catch (error) { return labError(error); }
}
