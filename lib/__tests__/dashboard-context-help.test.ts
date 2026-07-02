import { describe, expect, it } from "vitest";
import {
  dashboardNavPinnedItems,
  dashboardSettingsHelp,
} from "@/components/dashboard/navigation";

describe("dashboard contextual help", () => {
  it("documents every customer dashboard tool", () => {
    expect(dashboardNavPinnedItems.length).toBeGreaterThan(0);

    for (const item of dashboardNavPinnedItems) {
      expect(item.help.title.trim()).not.toBe("");
      expect(item.help.summary.trim()).not.toBe("");
    }
  });

  it("documents settings separately from the pinned navigation", () => {
    expect(dashboardSettingsHelp.title).toBe("Configurações");
    expect(dashboardSettingsHelp.summary).toContain("conta");
  });

  it("keeps lead integrations explicit about authorization", () => {
    const integrations = dashboardNavPinnedItems.find(
      (item) => item.routeKey === "integracoes-leads",
    );

    expect(integrations?.help.items?.join(" ")).toContain(
      "regras ativas e explícitas",
    );
  });
});
