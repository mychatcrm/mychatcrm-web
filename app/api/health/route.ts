import { NextResponse } from "next/server";
import { logAdminIaDataPlaneIssue, surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

// Health check tem de executar a cada pedido; sem isto o Next pré-renderiza
// a rota no build e congela a resposta (a sonda ao Supabase correria só no build).
export const dynamic = "force-dynamic";

export async function GET() {
  let aiUsageLogs:
    | { skipped: true }
    | { skipped: false; reachable: boolean; error: string | null; hint: string | null } = { skipped: true };

  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      const sb = createSupabaseServiceClient();
      const { error } = await sb.from("ai_usage_logs").select("id").limit(1);
      const errMsg = error?.message ?? null;
      const errCode = error?.code ?? null;
      if (error) {
        logAdminIaDataPlaneIssue("GET /api/health ai_usage_logs probe", {
          message: errMsg,
          code: errCode,
        });
      }
      const surf = surfacePostgrestForAdminUi(errMsg, errCode);
      aiUsageLogs = {
        skipped: false,
        reachable: !error,
        error: error ? surf.headline : null,
        hint: error ? surf.guidance : null,
      };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "supabase_unavailable";
    logAdminIaDataPlaneIssue("GET /api/health supabase client", { message: msg, code: null });
    const surf = surfacePostgrestForAdminUi(msg, null);
    aiUsageLogs = {
      skipped: false,
      reachable: false,
      error: surf.headline,
      hint: surf.guidance,
    };
  }

  return NextResponse.json(
    {
      ok: true,
      aiUsageLogs,
      deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
