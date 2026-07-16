import { NextResponse } from "next/server";
import { processRecentMetaLeadAds } from "@/lib/server/meta-lead-poller";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  console.info("[meta-lead-poller]", { event: "process_called", route: "/api/internal/process-meta-leads" });

  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    console.info("[meta-lead-poller]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (process.env.META_LEAD_POLLER_ENABLED !== "true") {
    console.info("[meta-lead-poller]", { event: "process_skipped", reason: "poller_disabled_by_default" });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "poller_disabled_by_default",
      message: "Meta Lead Ads poller is disabled by default to prevent historical backfill.",
    });
  }

  try {
    const result = await processRecentMetaLeadAds({ sb: createSupabaseServiceClient() });
    console.info("[meta-lead-poller]", { event: "process_completed", ...result });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[meta-lead-poller]", { event: "process_error", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
