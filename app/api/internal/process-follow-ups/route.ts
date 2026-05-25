import { NextResponse } from "next/server";
import { processDueFollowUpJobs } from "@/lib/server/follow-up-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { processRecentMetaLeadAds } from "@/lib/server/meta-lead-poller";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  console.info("[follow-up-jobs]", { event: "process_called", route: "/api/internal/process-follow-ups" });

  if (!verifyInternalApiRequest(request)) {
    console.info("[follow-up-jobs]", { event: "auth_failed" });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await processDueFollowUpJobs();

    let metaLeadPoll: Awaited<ReturnType<typeof processRecentMetaLeadAds>> | null = null;
    if (process.env.META_LEAD_POLLER_ENABLED === "true") {
      try {
        metaLeadPoll = await processRecentMetaLeadAds({ sb: createSupabaseServiceClient() });
        console.info("[meta-lead-poller]", { event: "follow_up_hook_completed", ...metaLeadPoll });
      } catch (pollErr) {
        const message = pollErr instanceof Error ? pollErr.message : String(pollErr);
        console.warn("[meta-lead-poller]", { event: "follow_up_hook_failed", error: message });
      }
    } else {
      console.info("[meta-lead-poller]", { event: "follow_up_hook_skipped", reason: "poller_disabled_by_default" });
    }

    console.info("[follow-up-jobs]", { event: "process_completed", ...result });
    return NextResponse.json({ ok: true, ...result, metaLeadPoll });
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[follow-up-jobs]", { event: "process_error", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
