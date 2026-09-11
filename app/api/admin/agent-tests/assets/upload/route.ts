import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { prepareLabAssetUpload, completeLabAssetUpload } from "@/lib/server/agent-test-lab/assets-store";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const owner = await requireLabOwner(request);
    const body = await request.text();
    if (body.length > 20000) throw new Error("upload_request_too_large");
    const input = JSON.parse(body);
    if (input.action === "complete") {
      const asset = await completeLabAssetUpload(String(input.id ?? ""));
      await appendOperationalAuditEvent({ actorType: "administrator", actorId: owner.adminId,
        module: "agent.test_lab", action: "asset.upload_completed", status: "completed", resourceType: "agent_test_lab_asset", resourceId: asset.id });
      return NextResponse.json({ ok: true, asset }, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action !== "prepare") throw new Error("upload_action_invalid");
    const ticket = await prepareLabAssetUpload(input);
    return NextResponse.json({ ok: true, ticket }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
