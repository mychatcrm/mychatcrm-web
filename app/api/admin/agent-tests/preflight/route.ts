import { NextResponse } from "next/server";
import { parseLabRunRequest } from "@/lib/agent-test-lab/contracts";
import { requireLabOwner, labError, labAudit } from "@/lib/server/agent-test-lab/auth";
import { inspectLabTarget } from "@/lib/server/agent-test-lab/preflight";
export const dynamic = "force-dynamic";
// operational-audit: reconciled — labAudit records the owner-only preflight.
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const input = parseLabRunRequest(await request.json());
    const result = await inspectLabTarget(input);
    await labAudit("preflight.checked");
    return NextResponse.json({ checks: result.checks, sha: result.sha, configHash: result.configHash, scenarioHash: result.scenarioHash,
      ok: result.checks.every(check => check.ok) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
