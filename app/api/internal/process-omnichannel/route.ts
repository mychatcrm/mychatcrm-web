import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { processDueLeadRedistributions } from "@/lib/server/lead-redistribution";
import { processDueWhatsAppCampaigns } from "@/lib/server/whatsapp-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request, { allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"] })) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const sb = createSupabaseServiceClient();
  try {
    const [campaigns, redistributions] = await Promise.all([
      processDueWhatsAppCampaigns(sb),
      processDueLeadRedistributions(sb),
    ]);
    return NextResponse.json({ ok: true, campaigns, redistributions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "omnichannel_process_failed";
    console.error("[omnichannel-processor]", { event: "failed", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
