/**
 * GET /api/client/stats/whatsapp-status
 *
 * Retorna o estado das instâncias Evolution do tenant (last-known-state do banco).
 * Não chama a Evolution API ao vivo para evitar latência.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { stringArray } from "@/lib/server/meta-form-authorization";
import type { WhatsAppInstanceStatus } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

type InstanceRow = {
  id: string;
  slot_index: number;
  instance_name: string;
  connection_state: string | null;
  wa_jid: string | null;
};

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const sb = createSupabaseServiceClient();

    const { data: instances, error } = await sb
      .from("tenant_evolution_instances")
      .select("id, slot_index, instance_name, connection_state, wa_jid")
      .eq("tenant_id", session.tenantId)
      .order("slot_index", { ascending: true })
      .returns<InstanceRow[]>();

    if (error) throw error;
    if (!instances || instances.length === 0) {
      return NextResponse.json([]);
    }

    // Quem atende cada linha é a regra de WhatsApp direto ligada àquela conexão,
    // não um `default_agent_id` gravado ao salvar o agente: a regra é a fonte de
    // verdade desde que o editor de agente deixou de escolher linha.
    const { data: rules } = await sb
      .from("lead_distribution_rules")
      .select("connection_id, agent_ids, active")
      .eq("tenant_id", session.tenantId)
      .eq("source", "whatsapp_organico")
      .eq("active", true)
      .in(
        "connection_id",
        instances.map((inst) => inst.id),
      );

    const agentIdByConnection = new Map<string, string>();
    for (const rule of (rules ?? []) as Array<{ connection_id: string | null; agent_ids: unknown }>) {
      const agentId = stringArray(rule.agent_ids)[0];
      if (rule.connection_id && agentId) agentIdByConnection.set(rule.connection_id, agentId);
    }

    const agentNames: Record<string, string> = {};
    const agentIds = [...new Set(agentIdByConnection.values())];
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

    const result: WhatsAppInstanceStatus[] = instances.map((inst) => {
      const agentId = agentIdByConnection.get(inst.id) ?? null;
      return {
        slotIndex: inst.slot_index,
        instanceName: inst.instance_name,
        connectionState: inst.connection_state ?? "close",
        waJid: inst.wa_jid ?? null,
        agentName: agentId ? (agentNames[agentId] ?? null) : null,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[stats/whatsapp-status] query failed:", err);
    return NextResponse.json({ error: "Erro ao carregar instâncias" }, { status: 500 });
  }
}
