import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminSessionFromCookies } from "@/lib/admin-auth";
import { isOperationalAuditOwnerIdentity, OPERATIONAL_AUDIT_OWNER_ADMIN_ID } from "@/lib/admin-operational-audit-access";
import { getAdminSessionByIdFromDb } from "@/lib/server/admin-auth-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { LAB_COOKIE, LAB_SESSION_SECONDS } from "@/lib/agent-test-lab/contracts";

export const labHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function labSecretMatches(value: string, digest: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(labHash(value), "hex"), Buffer.from(digest, "hex"));
}
export function assertLabOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new Error("lab_origin_rejected");
}
export async function labAudit(action: string, resourceId?: string, status: "completed" | "blocked" | "error" = "completed") {
  await appendOperationalAuditEvent({ actorType: "administrator", actorId: OPERATIONAL_AUDIT_OWNER_ADMIN_ID,
    module: "agent.test_lab", action, status, resourceType: "agent_test_lab", resourceId: resourceId ?? null,
    severity: status === "error" ? "error" : "info" }, { strict: true });
}
export async function unlockLab(request: Request): Promise<NextResponse> {
  assertLabOrigin(request);
  const owner = await getAdminSessionFromCookies();
  if (!owner || !isOperationalAuditOwnerIdentity(owner)) throw new Error("admin_session_required");
  // admin_users is intentionally unavailable through direct PostgREST table reads.
  // Reuse the restricted service-role RPC used by the regular admin session instead
  // of weakening table grants just for the laboratory.
  const persistedOwner = await getAdminSessionByIdFromDb(owner.adminId);
  if (!persistedOwner || !isOperationalAuditOwnerIdentity(persistedOwner)) throw new Error("owner_unavailable");
  const sb = createSupabaseServiceClient();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LAB_SESSION_SECONDS * 1000).toISOString();
  const passwordVersion = persistedOwner.passwordChangedAt > 0
    ? new Date(persistedOwner.passwordChangedAt).toISOString()
    : null;
  await labAudit("session.unlocked");
  const saved = await sb.from("agent_test_lab_sessions").insert({ token_hash: labHash(token), admin_id: owner.adminId,
    password_version: passwordVersion, expires_at: expiresAt });
  if (saved.error) throw new Error("lab_session_save_failed");
  const response = NextResponse.json({ ok: true, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(LAB_COOKIE, token, { httpOnly: true, secure: new URL(request.url).protocol === "https:",
    sameSite: "strict", path: "/", maxAge: LAB_SESSION_SECONDS });
  return response;
}
export async function requireLabOwner(request?: Request): Promise<{ adminId: string; tokenHash: string }> {
  if (process.env.AGENT_TEST_LAB_ENABLED !== "true") throw new Error("lab_disabled");
  if (request && !["GET", "HEAD"].includes(request.method)) assertLabOrigin(request);
  const token = (await cookies()).get(LAB_COOKIE)?.value ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("lab_locked");
  const sb = createSupabaseServiceClient();
  const { data: session, error } = await sb.from("agent_test_lab_sessions").select("admin_id,password_version,expires_at,revoked_at")
    .eq("token_hash", labHash(token)).maybeSingle();
  if (error || !session || session.revoked_at || Date.parse(session.expires_at) <= Date.now() || session.admin_id !== OPERATIONAL_AUDIT_OWNER_ADMIN_ID) throw new Error("lab_locked");
  const owner = await getAdminSessionByIdFromDb(session.admin_id);
  const sessionPasswordVersion = session.password_version ? Date.parse(session.password_version) : 0;
  if (!owner || !isOperationalAuditOwnerIdentity(owner) || !Number.isFinite(sessionPasswordVersion)
    || owner.passwordChangedAt !== sessionPasswordVersion) throw new Error("lab_locked");
  return { adminId: owner.adminId, tokenHash: labHash(token) };
}
export function labError(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : "lab_failed";
  const known = /^[a-z][a-z0-9_]{1,100}$/.test(code) ? code : "lab_failed";
  const status = ["lab_locked", "admin_session_required"].includes(known) ? 401 : known === "lab_origin_rejected" ? 403 : known === "lab_disabled" ? 503 : known === "rate_limited" ? 429 : 400;
  return NextResponse.json({ ok: false, code: known }, { status, headers: { "Cache-Control": "no-store" } });
}
