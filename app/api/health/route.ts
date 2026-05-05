import { NextResponse } from "next/server";
import { buildAiUsageLogsAccessHint } from "@/lib/ai/supabase-ai-usage-logs-diagnostics";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET() {
  let aiUsageLogs:
    | { skipped: true }
    | { skipped: false; reachable: boolean; error: string | null; hint: string | null } = { skipped: true };

  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      const sb = createSupabaseServiceClient();
      const { error } = await sb.from("ai_usage_logs").select("id").limit(1);
      const errMsg = error?.message ?? null;
      aiUsageLogs = {
        skipped: false,
        reachable: !error,
        error: errMsg,
        hint: buildAiUsageLogsAccessHint(errMsg),
      };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "supabase_unavailable";
    aiUsageLogs = {
      skipped: false,
      reachable: false,
      error: msg,
      hint: buildAiUsageLogsAccessHint(msg),
    };
  }

  return NextResponse.json(
    { ok: true, aiUsageLogs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
