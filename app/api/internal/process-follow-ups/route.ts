import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { processDueAgendaReminderJobs } from "@/lib/server/agenda-reminder-jobs";
import { processDueFollowUpJobs } from "@/lib/server/follow-up-jobs";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import {
  FOLLOW_UP_SCHEDULER_PATH,
  verifySignedSchedulerRequest,
} from "@/lib/server/meta-scheduler-auth";
import { processDueLeadRedistributions } from "@/lib/server/lead-redistribution";
import { isJourneyIsolationEnabled } from "@/lib/server/lead-journeys";
import { processRecentMetaLeadAds } from "@/lib/server/meta-lead-poller";
import { processDueWhatsAppCampaigns } from "@/lib/server/whatsapp-campaigns";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

async function runFollowUpProcessing(options?: {
  followUpsOnly?: boolean;
}): Promise<Record<string, unknown>> {
  try {
    const result = await processDueFollowUpJobs();
    if (options?.followUpsOnly) {
      console.info("[follow-up-jobs]", { event: "process_completed", ...result });
      return { ok: true, ...result };
    }

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

    let omnichannel: {
      campaigns: Awaited<ReturnType<typeof processDueWhatsAppCampaigns>>;
      redistributions: Awaited<ReturnType<typeof processDueLeadRedistributions>>;
    } | null = null;
    if (isJourneyIsolationEnabled()) {
      try {
        const sb = createSupabaseServiceClient();
        const [campaigns, redistributions] = await Promise.all([
          processDueWhatsAppCampaigns(sb),
          processDueLeadRedistributions(sb),
        ]);
        omnichannel = { campaigns, redistributions };
        console.info("[omnichannel-processor]", { event: "follow_up_hook_completed", ...omnichannel });
      } catch (omnichannelErr) {
        const message = omnichannelErr instanceof Error ? omnichannelErr.message : String(omnichannelErr);
        console.warn("[omnichannel-processor]", { event: "follow_up_hook_failed", error: message });
      }
    } else {
      console.info("[omnichannel-processor]", {
        event: "follow_up_hook_skipped",
        reason: "journeys_disabled",
      });
    }

    let agendaReminders: Awaited<ReturnType<typeof processDueAgendaReminderJobs>> | null = null;
    try {
      agendaReminders = await processDueAgendaReminderJobs({ sb: createSupabaseServiceClient() });
      console.info("[agenda-reminder-jobs]", { event: "follow_up_hook_completed", ...agendaReminders });
    } catch (reminderErr) {
      const message = reminderErr instanceof Error ? reminderErr.message : String(reminderErr);
      console.warn("[agenda-reminder-jobs]", { event: "follow_up_hook_failed", error: message });
    }

    console.info("[follow-up-jobs]", { event: "process_completed", ...result });
    return { ok: true, ...result, metaLeadPoll, omnichannel, agendaReminders };
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[follow-up-jobs]", { event: "process_error", error: message });
    throw error;
  }
}

export async function POST(request: Request) {
  console.info("[follow-up-jobs]", { event: "process_called", route: FOLLOW_UP_SCHEDULER_PATH });

  const bearerAuthorized = verifyInternalApiRequest(request, {
    allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"],
  });
  const signedAuth = bearerAuthorized
    ? null
    : verifySignedSchedulerRequest(request, FOLLOW_UP_SCHEDULER_PATH);

  if (!bearerAuthorized && !signedAuth?.ok) {
    console.info("[follow-up-jobs]", {
      event: "auth_failed",
      reason: signedAuth?.code ?? "scheduler_signature_invalid",
    });
    return NextResponse.json(
      {
        error:
          signedAuth?.status === 503
            ? "Scheduler não configurado."
            : "Não autorizado",
      },
      { status: signedAuth?.status ?? 401 },
    );
  }

  // Supabase invokes this endpoint every minute. Acknowledge immediately and
  // let Vercel finish the durable claimed work in the background. Existing
  // bearer callers keep the synchronous response contract for operations and
  // the daily Vercel fallback.
  if (signedAuth?.ok) {
    waitUntil(
      runFollowUpProcessing({ followUpsOnly: true }).catch((error) => {
        console.error("[follow-up-jobs]", {
          event: "signed_process_failed",
          error: error instanceof Error ? error.message : "process_failed",
        });
      }),
    );
    return NextResponse.json(
      { ok: true, accepted: true },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return NextResponse.json(await runFollowUpProcessing());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "process_failed" },
      { status: 500 },
    );
  }
}
