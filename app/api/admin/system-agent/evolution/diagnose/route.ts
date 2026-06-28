import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { buildEvolutionWebhookUrl, getPublicBaseUrlFromRequest } from "@/lib/integrations/evolution-webhook-url";
import {
  evolutionFetchInstances,
  evolutionPing,
  isEvolutionApiConfigured,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import { getSystemAgentInstanceName, getSystemAgentSession } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function maskWebhookUrl(url: string): string {
  return url.replace(/token=[^&]+/, "token=***");
}

/**
 * Diagnóstico avançado do agente do sistema.
 * Mostra a VERDADE da sessão WhatsApp (ownerJid via fetchInstances), webhook esperado e entregas recentes.
 */
export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  if (!isEvolutionApiConfigured()) {
    return NextResponse.json({ error: "Evolution API não configurada no servidor." }, { status: 503 });
  }

  const instanceName = await getSystemAgentInstanceName();
  const agentSession = await getSystemAgentSession();
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim() ?? "";
  const publicBase = getPublicBaseUrlFromRequest(request);
  const expectedWebhookUrl = webhookSecret
    ? maskWebhookUrl(buildEvolutionWebhookUrl(publicBase, webhookSecret))
    : null;

  const [instancesRes, pingRes] = await Promise.all([
    instanceName ? evolutionFetchInstances(instanceName) : Promise.resolve(null),
    evolutionPing(),
  ]);

  const instanceInfo =
    instancesRes?.ok && instanceName ? pickEvolutionInstanceInfo(instancesRes.data, instanceName) : null;

  let recent: Array<{
    type: string;
    status: string;
    to_number: string;
    response_status: unknown;
    message_id: unknown;
    delivered_at: unknown;
    delivery_failed_at: unknown;
    created_at: string;
  }> = [];
  let lastDeliveredAt: string | null = null;
  let pendingCount = 0;
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from("system_notifications_log")
      .select("type, status, to_number, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    recent = (data ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const deliveredAt = meta.delivered_at ?? null;
      if (row.status === "delivered" && typeof deliveredAt === "string" && !lastDeliveredAt) {
        lastDeliveredAt = deliveredAt;
      }
      if (row.status === "pending") pendingCount += 1;
      return {
        type: row.type,
        status: row.status,
        to_number: row.to_number,
        response_status: meta.evolution_response_status ?? null,
        message_id: meta.evolution_message_id ?? null,
        delivered_at: deliveredAt,
        delivery_failed_at: meta.delivery_failed_at ?? null,
        created_at: row.created_at,
      };
    });
  } catch {
    recent = [];
  }

  return NextResponse.json({
    instanceName,
    session: {
      connectionState: agentSession.connectionState,
      ownerJid: agentSession.ownerJid,
      profileName: agentSession.profileName,
      authenticated: agentSession.authenticated,
      source: agentSession.source,
    },
    instanceInfo: instanceInfo
      ? {
          connectionStatus: instanceInfo.connectionStatus,
          ownerJid: instanceInfo.ownerJid,
          profileName: instanceInfo.profileName,
        }
      : null,
    fetchInstancesOk: instancesRes?.ok ?? false,
    fetchInstancesError: instancesRes && !instancesRes.ok ? instancesRes.error : null,
    infrastructure: {
      evolutionReachable: pingRes.reachable,
      evolutionPingError: pingRes.reachable ? null : pingRes.error,
      webhookSecretConfigured: Boolean(webhookSecret),
      expectedWebhookUrl,
      publicBaseUrl: publicBase || null,
    },
    delivery: {
      lastDeliveredAt,
      recentPendingCount: pendingCount,
      webhookUpdatesWorking: lastDeliveredAt !== null,
    },
    recent,
  });
}
