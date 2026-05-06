import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { evolutionPing, isEvolutionApiConfigured } from "@/lib/integrations/evolution-api";

export const dynamic = "force-dynamic";

/**
 * Estado da integração Evolution (sem expor URLs completas nem chaves).
 * Requer sessão cliente autenticada.
 */
export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const apiConfigured = isEvolutionApiConfigured();
  const webhookSecretSet = Boolean(process.env.EVOLUTION_WEBHOOK_SECRET?.trim());

  if (!apiConfigured) {
    return NextResponse.json({
      evolutionConfigured: false,
      webhookSecretSet,
      evolutionReachable: null as boolean | null,
      evolutionPingError: null as string | null,
    });
  }

  const ping = await evolutionPing();
  return NextResponse.json({
    evolutionConfigured: true,
    webhookSecretSet,
    evolutionReachable: ping.reachable,
    evolutionPingError: ping.reachable ? null : ping.error,
  });
}
