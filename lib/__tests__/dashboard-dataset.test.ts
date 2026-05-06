import { describe, expect, it } from "vitest";
import type { ClientSession } from "../client-auth";
import { getDashboardDataset } from "../dashboard-data";

const baseSession: ClientSession = {
  token: "test-token",
  tenantId: "tenant-test-1",
  email: "user@example.com",
  displayName: "User Test",
  companyName: "Example Co",
  plan: "solo",
  planLabel: "Solo",
  initials: "UT",
  status: "ativa",
};

describe("getDashboardDataset", () => {
  it("starts with no seeded CRM leads and empty chart data", () => {
    const ds = getDashboardDataset(baseSession);
    expect(ds.tenantId).toBe("tenant-test-1");
    expect(ds.leads).toEqual([]);
    expect(ds.conversationBars).toEqual([]);
    expect(ds.funnelBars).toEqual([]);
    expect(ds.recentConversations).toEqual([]);
    expect(ds.alerts).toEqual([]);
  });

  it("does not embed demo-only copy in overview helpers", () => {
    const ds = getDashboardDataset(baseSession);
    const joined = ds.overviewMetrics.map((m) => m.helper).join(" ");
    expect(joined.toLowerCase()).not.toContain("demo");
    expect(joined.toLowerCase()).not.toContain("simulad");
  });
});
