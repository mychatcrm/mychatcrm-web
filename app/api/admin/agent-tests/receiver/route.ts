import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { inspectLabReceiver, connectLabReceiver, refreshLabReceiver, disconnectLabReceiver,
  switchLabReceiverProvider } from "@/lib/server/agent-test-lab/receiver";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// operational-audit: reconciled — receiver.ts audits the lifecycle before remote actions.

export async function GET(request: Request) {
  try { await requireLabOwner(request); return NextResponse.json({ connection: await inspectLabReceiver() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return labError(error); }
}

/**
 * Connects the line the isolated copy answers on. The copy is provisioned first,
 * so the number that is scanned always belongs to a configuration that exists.
 */
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const body = await request.json();
    if (body.action === "refresh") return NextResponse.json({ connection: await refreshLabReceiver() }, { headers: { "Cache-Control": "no-store" } });
    if (body.action !== "connect" && body.action !== "switch") throw new Error("invalid_action");
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (!tenantId || !agentId || tenantId.length > 150 || agentId.length > 150) throw new Error("invalid_source_agent");
    // Same contract as the tester line: remove only the laboratory's own link,
    // confirm the removal, and only then continue to the chosen provider.
    if (body.action === "switch") {
      const target = body.target === "meta_cloud" ? "meta_cloud" : body.target === "evolution" ? "evolution" : null;
      if (!target) throw new Error("invalid_connection_provider");
      const switched = await switchLabReceiverProvider(target, tenantId, agentId);
      return NextResponse.json({
        switched: switched.switched, connection: switched.connection, qr: switched.qr,
        copy: switched.copy
          ? { labTenantId: switched.copy.labTenantId, labAgentId: switched.copy.labAgentId, unavailable: switched.copy.unavailable }
          : null,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await connectLabReceiver(tenantId, agentId);
    return NextResponse.json({
      connection: result.connection, qr: result.qr,
      copy: { labTenantId: result.copy.labTenantId, labAgentId: result.copy.labAgentId, unavailable: result.copy.unavailable },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}

export async function DELETE(request: Request) {
  try { await requireLabOwner(request); await disconnectLabReceiver(); return NextResponse.json({ ok: true }); }
  catch (error) { return labError(error); }
}
