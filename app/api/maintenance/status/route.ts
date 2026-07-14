import { NextResponse } from "next/server";
import { readMaintenanceStatePublic } from "@/lib/server/maintenance-store-db";

// Sem isto o Next pré-renderiza a rota no build (executa o GET e congela a
// resposta), o que quebra o build sem credenciais Supabase reais e tornaria
// o estado de manutenção estático em produção.
export const dynamic = "force-dynamic";

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
