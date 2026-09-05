import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260905191217_grant_admin_security_config_to_service_role.sql",
), "utf8");

describe("admin security configuration permissions", () => {
  it("keeps browser roles locked out", () => {
    expect(migration).toContain(
      "revoke all on table public.admin_security_config from public, anon, authenticated",
    );
  });

  it("grants only the operations used by the authenticated admin API", () => {
    expect(migration).toContain(
      "grant select, insert, update on table public.admin_security_config to service_role",
    );
    expect(migration).not.toMatch(/grant\s+delete/i);
  });
});
