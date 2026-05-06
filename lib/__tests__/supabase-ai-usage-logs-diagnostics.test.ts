import { describe, expect, it } from "vitest";
import { buildAiUsageLogsAccessHint } from "@/lib/ai/supabase-ai-usage-logs-diagnostics";

describe("buildAiUsageLogsAccessHint", () => {
  it("returns guidance for permission denied", () => {
    const h = buildAiUsageLogsAccessHint('permission denied for table "ai_usage_logs"', "42501");
    expect(h).toBeTruthy();
    expect(h).toContain("service_role");
    expect(h!.toLowerCase()).not.toContain("ai_usage_logs");
  });

  it("returns guidance for missing table without naming relation", () => {
    const h = buildAiUsageLogsAccessHint(
      "Could not find the table 'public.ai_usage_logs' in the schema cache",
      "PGRST205",
    );
    expect(h).toBeTruthy();
    expect(h!.toLowerCase()).not.toContain("ai_usage_logs");
    expect(h).toContain(".env.example");
  });

  it("returns null when no error", () => {
    expect(buildAiUsageLogsAccessHint(null)).toBeNull();
    expect(buildAiUsageLogsAccessHint("")).toBeNull();
  });
});
