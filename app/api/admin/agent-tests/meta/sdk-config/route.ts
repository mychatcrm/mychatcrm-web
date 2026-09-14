import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireLabOwner(request);
    const appId = process.env.META_APP_ID?.trim();
    const configId = process.env.META_WA_CONFIG_ID?.trim() ?? "1020220517466691";
    if (!appId) throw new Error("meta_server_not_configured");
    return NextResponse.json({ app_id: appId, config_id: configId }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return labError(error);
  }
}
