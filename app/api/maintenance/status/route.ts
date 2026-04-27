import { NextResponse } from "next/server";
import { readMaintenanceState } from "@/lib/server/maintenance-store-fs";

/** Estado público (sem dados internos além da mensagem configurada). */
export async function GET() {
  const s = readMaintenanceState();
  return NextResponse.json(
    {
      enabled: s.enabled,
      message: s.message || undefined,
      estimatedReturnAt: s.estimatedReturnAt || undefined,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
