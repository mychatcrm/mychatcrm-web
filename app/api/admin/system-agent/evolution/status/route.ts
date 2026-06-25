import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { evolutionPing, isEvolutionApiConfigured } from "@/lib/integrations/evolution-api";

export const dynamic = "force-dynamic";

/**
 * Estado da integração Evolution para o painel admin do agente do sistema.
 */
export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
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
