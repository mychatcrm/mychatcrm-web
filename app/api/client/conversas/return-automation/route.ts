/**
 * POST /api/client/conversas/return-automation
 * Retorna conversa para automação e bloqueia envio humano.
 *
 * Prioridade do agente ao reassumir:
 *   1. lead.campaign_agent_id (se campaign_active = true) — campanha Meta ativa
 *   2. instance.organic_agent_id                         — agente orgânico do slot
 *   3. instance.default_agent_id                         — agente padrão (legacy)
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { returnConversationToAutomation } from "@/lib/server/conversation-operation";
import { remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: { remoteJid?: string };
  try {
    body = (await request.json()) as { remoteJid?: string };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const remoteJid = body.remoteJid?.trim();
  if (!remoteJid) {
    return NextResponse.json({ error: "remoteJid é obrigatório" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();

  // 1. If lead has an active campaign, the campaign agent reassumes after handoff
  let agentId: string | null = null;
  const phone = remoteJidToEvoNumber(remoteJid);

  if (phone) {
    const { data: leadRaw } = await sb
      .from("leads")
      .select("campaign_agent_id, campaign_active")
      .eq("tenant_id", session.tenantId)
      .eq("phone", phone)
      .maybeSingle();

    const lead = leadRaw as {
      campaign_agent_id: string | null;
      campaign_active: boolean;
    } | null;

    if (lead?.campaign_active && lead.campaign_agent_id) {
      agentId = lead.campaign_agent_id;
    }
  }

  // 2 & 3. Fallback: organic_agent_id or default_agent_id from the slot
  if (!agentId) {
    const { data: instanceRaw } = await sb
      .from("tenant_evolution_instances")
      .select("organic_agent_id, default_agent_id")
      .eq("tenant_id", session.tenantId)
      .order("slot_index", { ascending: true })
      .limit(1)
      .maybeSingle();

    const instance = instanceRaw as {
      organic_agent_id: string | null;
      default_agent_id: string | null;
    } | null;

    agentId = instance?.organic_agent_id ?? instance?.default_agent_id ?? null;
  }

  const actorId = session.employeeId ?? session.email;
  const result = await returnConversationToAutomation({
    sb,
    tenantId: session.tenantId,
    remoteJid,
    actorId,
    actorName: session.displayName,
    agentId,
  });

  return NextResponse.json({ ok: true, operation: result.operation });
}
