import { NextResponse } from "next/server";
import { readMaintenanceStatePublic } from "@/lib/server/maintenance-store-db";

/** Estado público (sem dados internos além da mensagem configurada). */
export async function GET() {
  const s = await readMaintenanceStatePublic();
  return NextResponse.json(
    {
      enabled: s.enabled,
      message: s.message || undefined,
      estimatedReturnAt: s.estimatedReturnAt || undefined,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
