import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/** Returns the public Meta app config needed to initialise the FB JS SDK on the admin panel. */
export async function GET(): Promise<NextResponse> {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.META_APP_ID?.trim();
  const configId = process.env.META_WA_CONFIG_ID?.trim() ?? "1020220517466691";

  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID not configured" }, { status: 503 });
  }

  return NextResponse.json({ app_id: appId, config_id: configId });
}
