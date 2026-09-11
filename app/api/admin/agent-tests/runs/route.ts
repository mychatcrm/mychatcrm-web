import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { parseLabRunRequest } from "@/lib/agent-test-lab/contracts";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { createLabRun, listLabRuns } from "@/lib/server/agent-test-lab/runs";
import { startLabRunProcessing } from "@/lib/server/agent-test-lab/dispatch";
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
    if (result.ok) waitUntil(startLabRunProcessing(result.run.id, result.run.mode));
    return NextResponse.json(result, { status: result.ok ? 201 : 409, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
