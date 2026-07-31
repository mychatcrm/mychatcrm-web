import { NextResponse } from "next/server";
import { verifyInternalApiRequest } from "@/lib/server/internal-api-auth";
import { processMetaLeadgenInbox } from "@/lib/server/meta-leadgen-inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    const result = await processMetaLeadgenInbox({ limit: 5 });
    console.info("[meta-leadgen-inbox] cron_completed", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[meta-leadgen-inbox] cron_failed", {
      error:
        error instanceof Error
          ? error.message
          : "meta_leadgen_inbox_process_failed",
    });
    return NextResponse.json(
      { ok: false, error: "meta_leadgen_inbox_process_failed" },
      { status: 500 },
    );
  }
}
