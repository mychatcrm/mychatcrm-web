import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260826155559_close_public_security_definer_execution.sql"),
  "utf8",
).toLowerCase();

describe("backend-only security-definer RPCs", () => {
  const functions = [
    "consume_password_reset_token", "get_admin_by_email", "get_admin_by_id",
    "get_member_by_email", "request_password_reset_token", "tenant_member_email_exists",
    "update_admin_password", "update_member_password", "upsert_tenant_member",
    "verify_admin_password", "verify_member_password",
  ];

  it("revokes the implicit PUBLIC grant and both browser roles", () => {
    expect(migration).toContain("alter default privileges for role postgres in schema public");
    expect(migration).toContain("revoke execute on functions from public");
    for (const name of functions) {
      const revokeStart = migration.indexOf(`revoke all on function public.${name}`);
      expect(revokeStart, name).toBeGreaterThan(-1);
      expect(migration.slice(revokeStart, revokeStart + 500)).toContain("from public, anon, authenticated");
    }
  });

  it("grants execution only to service_role and pins advisor-reported search paths", () => {
    for (const name of functions) {
      expect(migration).toContain(`grant execute on function public.${name}`);
    }
    expect(migration).toContain("to service_role");
    expect(migration).toContain("set search_path = public, extensions");
  });
});
