import { describe, expect, it } from "vitest";
import { isOperationalAuditOwnerIdentity } from "@/lib/admin-operational-audit-access";

describe("operational audit owner boundary", () => {
  it("allows only the exact owner super admin", () => {
    expect(isOperationalAuditOwnerIdentity({ adminId: "admin-renato-lagares", role: "super_admin" })).toBe(true);
  });

  it.each([
    ["another-super-admin", "super_admin"],
    ["admin-renato-lagares", "admin"],
    ["admin-renato-lagares", "desenvolvedor"],
  ] as const)("blocks adminId=%s role=%s", (adminId, role) => {
    expect(isOperationalAuditOwnerIdentity({ adminId, role })).toBe(false);
  });
});
