import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { connectLabMetaSender, switchLabSenderProvider } from "@/lib/server/agent-test-lab/connections";
import { connectLabMetaReceiver, switchLabReceiverProvider } from "@/lib/server/agent-test-lab/receiver";
import { exchangeLabMetaCode } from "@/lib/server/agent-test-lab/meta-onboarding";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// operational-audit: reconciled — connection modules audit before persistence.
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const body = await request.json();
    const purpose = body.purpose === "receiver" ? "receiver" : body.purpose === "sender" ? "sender" : null;
    if (!purpose) throw new Error("invalid_connection_purpose");
    const credentials = await exchangeLabMetaCode({
      code: body.code,
      wabaId: body.waba_id,
      phoneNumberId: body.phone_number_id,
      purpose,
    });
    const replaceExisting = body.replace_existing === true;
    if (purpose === "sender") {
      if (replaceExisting) await switchLabSenderProvider("meta_cloud");
      return NextResponse.json(await connectLabMetaSender(credentials), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (!tenantId || !agentId || tenantId.length > 150 || agentId.length > 150) throw new Error("invalid_source_agent");
    if (replaceExisting) await switchLabReceiverProvider("meta_cloud", tenantId, agentId);
    const result = await connectLabMetaReceiver(tenantId, agentId, credentials);
    return NextResponse.json({
      connection: result.connection,
      qr: null,
      copy: {
        labTenantId: result.copy.labTenantId,
        labAgentId: result.copy.labAgentId,
        unavailable: result.copy.unavailable,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[agent-test-lab/meta] connection_failed", {
      code: error instanceof Error ? error.message : "lab_failed",
    });
    return labError(error);
  }
}
