import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";
import { resolveDirectWhatsAppAgentFromRules } from "@/lib/server/agent-channel-authorization";

/**
 * Resolve o agente para respostas automáticas Evolution com autorização estrita:
 *
 *   1. lead.campaign_agent_id / lead.agent_id — somente se a regra atual do canal permitir.
 *   2. instance.organic_agent_id              — somente se houver regra whatsapp_organico ativa.
 *   3. primeira regra whatsapp_organico ativa — fallback autorizado para WhatsApp direto.
 *
 * @param tenantId      Tenant do evento.
 * @param storedDefault legado mantido na assinatura; não autoriza resposta automática.
 * @param leadPhone     Número do remetente normalizado (só dígitos, com DDI).
 *                      Quando fornecido, consulta leads para campanha ativa ou agent_id.
 * @param instanceName  Nome da instância Evolution. Quando fornecido, permite buscar
 *                      organic_agent_id do slot correto.
 */
export async function resolveEvolutionAgentId(
  tenantId: string,
  _storedDefault: string | null,
  leadPhone?: string | null,
  instanceName?: string | null,
): Promise<string | null> {
  const sb = createSupabaseServiceClient();

  // 1. Consult lead record for campaign or sticky agent, but never trust it alone.
  if (leadPhone) {
    const { data: leadRaw } = await sb
      .from("leads")
      .select("id, agent_id, campaign_agent_id, campaign_active, source")
      .eq("tenant_id", tenantId)
      .eq("phone", leadPhone)
      .maybeSingle();

    const lead = leadRaw as {
      agent_id: string | null;
      id: string | null;
      campaign_agent_id: string | null;
      campaign_active: boolean;
      source: string | null;
    } | null;

    const candidateAgentId = lead?.campaign_active
      ? lead.campaign_agent_id
      : lead?.agent_id ?? lead?.campaign_agent_id;

    if (lead && candidateAgentId) {
      const guard = await canAgentAutoContactLead({
        sb,
        tenantId,
        agentId: candidateAgentId,
        leadId: lead.id,
        phone: leadPhone,
        source: lead.source,
        triggerSource: lead?.campaign_active
          ? "evolution_agent_resolve_campaign"
          : "evolution_agent_resolve_direct",
      });
      if (guard.ok) {
        return candidateAgentId;
      }
      console.warn("[evolution-agent-resolve] lead agent blocked", {
        tenant_id: tenantId,
        agent_id: candidateAgentId,
        lead_id: lead.id,
        form_id: guard.formId,
        reason: guard.reason,
      });
    }
  }

  // 2. organic_agent_id from the specific Evolution slot, validated against lead rules.
  if (instanceName) {
    const { data: instanceRaw } = await sb
      .from("tenant_evolution_instances")
      .select("id, organic_agent_id")
      .eq("tenant_id", tenantId)
      .eq("instance_name", instanceName)
      .maybeSingle();

    const instance = instanceRaw as {
      id: string;
      organic_agent_id: string | null;
    } | null;

    const authorized = await resolveDirectWhatsAppAgentFromRules({
      sb,
      tenantId,
      preferredAgentId: instance?.organic_agent_id,
      connectionId: instance?.id,
    });
    if (authorized) return authorized.agentId;
  }

  // A resolver without a transport identity cannot prove which WhatsApp line
  // received the event. Do not turn it into a tenant-wide fallback.
  return null;
}
