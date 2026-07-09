import { describe, expect, it } from "vitest";
import {
  canCreateActiveOffer,
  canViewActiveOfferProgress,
  offerVisibleToEmployee,
} from "@/lib/server/active-offers-auth";
import type { ClientSession } from "@/lib/client-auth";

function session(partial: Partial<ClientSession>): ClientSession {
  return {
    token: "t",
    tenantId: "tenant-a",
    email: "u@example.com",
    displayName: "User",
    companyName: "Co",
    plan: "solo",
    planLabel: "Solo",
    initials: "U",
    status: "ativa",
    ...partial,
  };
}

describe("active-offers-auth", () => {
  it("allows owner and director to create offers", () => {
    expect(canCreateActiveOffer(session({ organizationRole: "owner" }))).toBe(true);
    expect(canCreateActiveOffer(session({ organizationRole: "director", employeeId: "dir-1" }))).toBe(true);
    expect(canCreateActiveOffer(session({ organizationRole: "manager", employeeId: "mgr-1" }))).toBe(false);
    expect(canCreateActiveOffer(session({ organizationRole: "seller", employeeId: "sel-1" }))).toBe(false);
  });

  it("scopes offer visibility for sellers", () => {
    expect(
      offerVisibleToEmployee({
        assigneeIds: [],
        employeeId: "sel-1",
        isCreatorOrManager: false,
      }),
    ).toBe(true);

    expect(
      offerVisibleToEmployee({
        assigneeIds: ["sel-1"],
        employeeId: "sel-1",
        isCreatorOrManager: false,
      }),
    ).toBe(true);

    expect(
      offerVisibleToEmployee({
        assigneeIds: ["sel-2"],
        employeeId: "sel-1",
        isCreatorOrManager: false,
      }),
    ).toBe(false);

    expect(
      offerVisibleToEmployee({
        assigneeIds: ["sel-2"],
        employeeId: "sel-1",
        isCreatorOrManager: true,
      }),
    ).toBe(true);
  });

  it("allows managers to view progress", () => {
    expect(canViewActiveOfferProgress(session({ organizationRole: "manager", employeeId: "mgr-1" }))).toBe(true);
    expect(canViewActiveOfferProgress(session({ organizationRole: "seller", employeeId: "sel-1" }))).toBe(false);
  });
});
