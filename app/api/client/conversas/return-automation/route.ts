/**
 * POST /api/client/conversas/return-automation
 * Retorna conversa para automação e bloqueia envio humano.
 *
 * Prioridade do agente ao reassumir:
 *   1. lead.campaign_agent_id / lead.agent_id — somente se a regra atual do canal permitir
 *   2. regra whatsapp_organico ativa          — atendimento privado direto autorizado
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { returnConversationToAutomation } from "@/lib/server/conversation-operation";
import { remoteJidToEvoNumber } from "@/lib/integrations/evolution-api";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { resolveDirectWhatsAppAgentFromRules } from "@/lib/server/agent-channel-authorization";

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

  // 1. Lead agent can reassume only while the current channel rule still authorizes it.
  let agentId: string | null = null;
  const phone = remoteJidToEvoNumber(remoteJid);

  if (phone) {
    const { data: leadRaw } = await sb
      .from("leads")
      .select("id, source, agent_id, campaign_agent_id, campaign_active")
      .eq("tenant_id", session.tenantId)
      .eq("phone", phone)
      .maybeSingle();

    const lead = leadRaw as {
      agent_id: string | null;
      campaign_agent_id: string | null;
      campaign_active: boolean;
      id?: string | null;
      source?: string | null;
    } | null;

    const candidateAgentId = lead?.campaign_active
      ? lead.campaign_agent_id
      : lead?.agent_id ?? lead?.campaign_agent_id;

    if (lead && candidateAgentId) {
      const guard = await canAgentAutoContactLead({
        sb,
        tenantId: session.tenantId,
        agentId: candidateAgentId,
        leadId: lead.id,
        phone,
        source: lead.source,
        triggerSource: lead?.campaign_active ? "return_automation_campaign" : "return_automation_direct",
      });
      if (guard.ok) {
        agentId = candidateAgentId;
      }
    }
  }

  // 2. Fallback only to an explicit direct WhatsApp lead rule. Never use default_agent_id.
  if (!agentId) {
    const { data: instanceRaw } = await sb
      .from("tenant_evolution_instances")
      .select("organic_agent_id")
      .eq("tenant_id", session.tenantId)
      .order("slot_index", { ascending: true })
      .limit(1)
      .maybeSingle();

    const instance = instanceRaw as {
      organic_agent_id: string | null;
    } | null;

    const organic = await resolveDirectWhatsAppAgentFromRules({
      sb,
      tenantId: session.tenantId,
      preferredAgentId: instance?.organic_agent_id,
    });
    agentId = organic?.agentId ?? null;
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
