import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { processDueExternalApiCatalogSyncs } from "@/lib/server/external-api-catalog-sync";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!verifyInternalApiRequest(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    const result = await processDueExternalApiCatalogSyncs(createSupabaseServiceClient(), { limit: 20 });
    console.info("[external-api-catalog-sync]", { event: "process_completed", ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "process_failed";
    console.error("[external-api-catalog-sync]", { event: "process_error", error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
