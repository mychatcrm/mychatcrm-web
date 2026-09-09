import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { parseLabRunRequest } from "@/lib/agent-test-lab/contracts";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { createLabRun, listLabRuns, tickInternalLabRun } from "@/lib/server/agent-test-lab/runs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// operational-audit: database-triggered — runs are audited transactionally.
export async function GET(request: Request) {
  try { await requireLabOwner(request); return NextResponse.json({ runs: await listLabRuns() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return labError(error); }
}
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const result = await createLabRun(parseLabRunRequest(await request.json()));
    if (result.ok) waitUntil(tickInternalLabRun(result.run.id).catch(() => { /* Durable queued row is recovered by worker. */ }));
    return NextResponse.json(result, { status: result.ok ? 201 : 409, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
