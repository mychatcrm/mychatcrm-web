import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  evolutionFetchInstances,
  isEvolutionApiConfigured,
  pickEvolutionInstanceInfo,
} from "@/lib/integrations/evolution-api";
import { getSystemAgentInstanceName, getSystemAgentSession } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico avançado do agente do sistema.
 * Mostra a VERDADE da sessão WhatsApp (ownerJid via fetchInstances), não apenas o estado
 * "open" do connectionState — que pode reportar conectado numa sessão zumbi.
 */
export async function GET() {
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

  const instancesRes = instanceName ? await evolutionFetchInstances(instanceName) : null;
  const instanceInfo =
    instancesRes?.ok && instanceName ? pickEvolutionInstanceInfo(instancesRes.data, instanceName) : null;

  let recent: Array<{
    type: string;
    status: string;
    to_number: string;
    response_status: unknown;
    message_id: unknown;
    delivered_at: unknown;
    created_at: string;
  }> = [];
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from("system_notifications_log")
      .select("type, status, to_number, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    recent = (data ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        type: row.type,
        status: row.status,
        to_number: row.to_number,
        response_status: meta.evolution_response_status ?? null,
        message_id: meta.evolution_message_id ?? null,
        delivered_at: meta.delivered_at ?? null,
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
    recent,
  });
}
