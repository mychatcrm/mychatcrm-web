import { describe, expect, it } from "vitest";
import { buildAiUsageLogsAccessHint } from "@/lib/ai/supabase-ai-usage-logs-diagnostics";

describe("buildAiUsageLogsAccessHint", () => {
  it("returns hint for permission denied", () => {
    const h = buildAiUsageLogsAccessHint('permission denied for table "ai_usage_logs"');
    expect(h).toBeTruthy();
    expect(h).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(h).toContain("service_role");
  });

  it("returns hint for missing table", () => {
    const h = buildAiUsageLogsAccessHint(
      "Could not find the table 'public.ai_usage_logs' in the schema cache",
    );
    expect(h).toBeTruthy();
    expect(h).toContain("20260505_ai_gateway_usage_tracking");
  });

  it("returns null when no error", () => {
    expect(buildAiUsageLogsAccessHint(null)).toBeNull();
    expect(buildAiUsageLogsAccessHint("")).toBeNull();
  });
});
