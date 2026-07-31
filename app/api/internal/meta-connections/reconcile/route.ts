import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { reconcileMetaLeadConnections } from "@/lib/server/meta-lead-connection-reconciler";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (
    !verifyInternalApiRequest(request, {
      allowedSecrets: ["INTERNAL_API_TOKEN", "CRON_SECRET"],
    })
  ) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await reconcileMetaLeadConnections({
      sb: createSupabaseServiceClient(),
      limit: 50,
    });
    console.info("[meta-health-reconcile]", {
      checked: result.checked,
      ready: result.ready,
      degraded: result.degraded,
      actionRequired: result.actionRequired,
      grantsChecked: result.grantsChecked,
      pagesDiscovered: result.pagesDiscovered,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "meta_health_reconcile_failed";
    console.error("[meta-health-reconcile] failed", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
