import { describe, expect, it } from "vitest";
import {
  canCreateActiveOffer,
  canDispositionLead,
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
  // Gerente ganhou o mesmo poder do diretor sobre listas de ligação; o limite
  // dele é de alcance (só leads da equipe), não de papel.
  it("allows owner, director and manager to create offers", () => {
    expect(canCreateActiveOffer(session({ organizationRole: "owner" }))).toBe(true);
    expect(canCreateActiveOffer(session({ organizationRole: "director", employeeId: "dir-1" }))).toBe(true);
    expect(canCreateActiveOffer(session({ organizationRole: "manager", employeeId: "mgr-1" }))).toBe(true);
    expect(canCreateActiveOffer(session({ organizationRole: "seller", employeeId: "sel-1" }))).toBe(false);
  });

  it("lets manager and director disposition leads, but keeps seller restricted", () => {
    const base = { assigneeIds: [] as string[], assignedEmployeeId: null, distributionMode: "shared_pool" };
    expect(
      canDispositionLead({ ...base, session: session({ organizationRole: "manager", employeeId: "mgr-1" }) }),
    ).toBe(true);
    expect(
      canDispositionLead({ ...base, session: session({ organizationRole: "director", employeeId: "dir-1" }) }),
    ).toBe(true);
    expect(
      canDispositionLead({
        session: session({ organizationRole: "seller", employeeId: "sel-1" }),
        assigneeIds: ["sel-2"],
        assignedEmployeeId: null,
        distributionMode: "shared_pool",
      }),
    ).toBe(false);
  });

  it("keeps seller limited to leads assigned to them when splitting evenly", () => {
    expect(
      canDispositionLead({
        session: session({ organizationRole: "seller", employeeId: "sel-1" }),
        assigneeIds: ["sel-1", "sel-2"],
        assignedEmployeeId: "sel-2",
        distributionMode: "split_evenly",
      }),
    ).toBe(false);
    expect(
      canDispositionLead({
        session: session({ organizationRole: "seller", employeeId: "sel-1" }),
        assigneeIds: ["sel-1", "sel-2"],
        assignedEmployeeId: "sel-1",
        distributionMode: "split_evenly",
      }),
    ).toBe(true);
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
