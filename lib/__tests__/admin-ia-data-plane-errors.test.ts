import { describe, expect, it } from "vitest";
import { surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";

describe("surfacePostgrestForAdminUi", () => {
  it("never echoes raw permission denied text", () => {
    const s = surfacePostgrestForAdminUi('permission denied for table "ai_usage_logs"', "42501");
    expect(s.headline.toLowerCase()).not.toContain("ai_usage");
    expect(s.headline.toLowerCase()).not.toContain("permission denied");
    expect(s.guidance).toBeTruthy();
    expect(s.guidance!.toLowerCase()).toContain("infraestrutura");
  });

  it("maps missing table without naming relation", () => {
    const s = surfacePostgrestForAdminUi("Could not find the table 'public.ai_usage_logs' in the schema cache", "PGRST205");
    expect(s.headline.toLowerCase()).not.toContain("ai_usage");
    expect(s.guidance!.toLowerCase()).toContain("migrações");
  });
});
