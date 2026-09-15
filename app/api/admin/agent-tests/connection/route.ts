import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { inspectLabSender, connectLabSender, disconnectLabSender, refreshLabSender,
  switchLabSenderProvider } from "@/lib/server/agent-test-lab/connections";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// operational-audit: reconciled — lifecycle is audited by connections.ts before remote actions.
export async function GET(request: Request) {
  try { await requireLabOwner(request); return NextResponse.json({ connection: await inspectLabSender() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return labError(error); }
}
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const body = await request.json();
    if (body.action === "refresh") return NextResponse.json({ connection: await refreshLabSender() }, { headers: { "Cache-Control": "no-store" } });
    // Switching provider removes only this laboratory link, and only after the
    // owner confirmed it in the panel. Audited in connections.ts either way.
    if (body.action === "switch") {
      const target = body.target === "meta_cloud" ? "meta_cloud" : body.target === "evolution" ? "evolution" : null;
      if (!target) throw new Error("invalid_connection_provider");
      return NextResponse.json(await switchLabSenderProvider(target), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "connect") throw new Error("invalid_action");
    return NextResponse.json(await connectLabSender(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
export async function DELETE(request: Request) {
  try { await requireLabOwner(request); await disconnectLabSender(); return NextResponse.json({ ok: true }); }
  catch (error) { return labError(error); }
}
