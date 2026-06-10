/**
 * GET /api/client/stats/whatsapp-status
 *
 * Retorna o estado das instâncias Evolution do tenant (last-known-state do banco).
 * Não chama a Evolution API ao vivo para evitar latência.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { WhatsAppInstanceStatus } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const sb = createSupabaseServiceClient();

    const { data: instances, error } = await sb
      .from("tenant_evolution_instances")
      .select("slot_index, instance_name, connection_state, wa_jid, default_agent_id")
      .eq("tenant_id", session.tenantId)
      .order("slot_index", { ascending: true });

    if (error) throw error;
    if (!instances || instances.length === 0) {
      return NextResponse.json([]);
    }

    const agentIds = instances
      .map((i) => i.default_agent_id as string | null)
      .filter((id): id is string => Boolean(id));

    const agentNames: Record<string, string> = {};
    if (agentIds.length > 0) {
      const { data: agents } = await sb
        .from("tenant_agents")
        .select("agent_id, display_name")
        .eq("tenant_id", session.tenantId)
        .in("agent_id", agentIds);
      for (const agent of agents ?? []) {
        agentNames[agent.agent_id as string] = agent.display_name as string;
      }
    }

    const result: WhatsAppInstanceStatus[] = instances.map((inst) => ({
      slotIndex: inst.slot_index as number,
      instanceName: inst.instance_name as string,
      connectionState: (inst.connection_state as string) ?? "close",
      waJid: (inst.wa_jid as string | null) ?? null,
      agentName:
        inst.default_agent_id
          ? (agentNames[inst.default_agent_id as string] ?? null)
          : null,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[stats/whatsapp-status] query failed:", err);
    return NextResponse.json({ error: "Erro ao carregar instâncias" }, { status: 500 });
  }
}
