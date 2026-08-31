import { NextResponse } from "next/server";
import { adminSessionCookieOptions, getAdminSessionFromCookies } from "@/lib/admin-auth";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

export async function POST() {
  const session = await getAdminSessionFromCookies();
  if (session) {
    await appendOperationalAuditEvent({
      actorType: "administrator", actorId: session.adminId,
      module: "auth.admin", action: "logout.completed", status: "completed",
      critical: true, resourceType: "admin_session", resourceId: session.adminId,
      resultCode: "session_cleared", relatedIds: { admin_id: session.adminId },
    }, { strict: true }).catch(() => null);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...adminSessionCookieOptions(),
    value: "",
    maxAge: 0,
  });
  return response;
}
