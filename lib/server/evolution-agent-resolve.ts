import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTemplateAgentsForTenant } from "@/lib/agents/template-agents";
import { canAgentAutoContactLead } from "@/lib/server/agent-auto-contact-guard";

/**
 * Resolve o agente para respostas automáticas Evolution com o seguinte sistema
 * de prioridade (do mais alto para o mais baixo):
 *
 *   0. env EVOLUTION_DEFAULT_AGENT_ID  — override global para debugging
 *   1. lead.campaign_agent_id          — campanha Meta Lead Ads ativa (prioridade máxima)
 *   2. lead.agent_id                   — agente gravado no lead SEM campanha ativa
 *   3. instance.organic_agent_id       — agente orgânico do slot WhatsApp
 *   4. instance.default_agent_id       — agente padrão do slot (legacy)
 *   5. storedDefault                   — default_agent_id passado pelo caller
 *   6. primeiro tenant_agent ativo
 *   7. primeiro template do tenant
 *
 * @param tenantId      Tenant do evento.
 * @param storedDefault default_agent_id armazenado na instância Evolution (pode ser null).
 * @param leadPhone     Número do remetente normalizado (só dígitos, com DDI).
 *                      Quando fornecido, consulta leads para campanha ativa ou agent_id.
 * @param instanceName  Nome da instância Evolution. Quando fornecido, permite buscar
 *                      organic_agent_id e default_agent_id do slot correto.
 */
export async function resolveEvolutionAgentId(
  tenantId: string,
  storedDefault: string | null,
  leadPhone?: string | null,
  instanceName?: string | null,
): Promise<string> {
  // 0. Override global via env (useful for debugging / single-tenant deployments)
  const fromEnv = process.env.EVOLUTION_DEFAULT_AGENT_ID?.trim();
  if (fromEnv) return fromEnv;

  const sb = createSupabaseServiceClient();

  // 1 & 2. Consult lead record for campaign or sticky agent
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

    if (lead?.campaign_active && lead.campaign_agent_id) {
      const guard = await canAgentAutoContactLead({
        sb,
        tenantId,
        agentId: lead.campaign_agent_id,
        leadId: lead.id,
        phone: leadPhone,
        source: lead.source,
        triggerSource: "evolution_agent_resolve_campaign",
      });
      if (guard.ok) {
        // Active campaign: the campaign agent has maximum priority only while currently authorized.
        return lead.campaign_agent_id;
      }
      console.warn("[evolution-agent-resolve] campaign agent blocked", {
        tenant_id: tenantId,
        agent_id: lead.campaign_agent_id,
        lead_id: lead.id,
        form_id: guard.formId,
        reason: guard.reason,
      });
    }

    if (lead?.agent_id && !lead.campaign_active) {
      // Lead without active campaign: use its own agent_id (may be organic slot agent)
      return lead.agent_id;
    }
  }

  // 3 & 4. organic_agent_id / default_agent_id from the specific Evolution slot
  if (instanceName) {
    const { data: instanceRaw } = await sb
      .from("tenant_evolution_instances")
      .select("organic_agent_id, default_agent_id")
      .eq("tenant_id", tenantId)
      .eq("instance_name", instanceName)
      .maybeSingle();

    const instance = instanceRaw as {
      organic_agent_id: string | null;
      default_agent_id: string | null;
    } | null;

    if (instance?.organic_agent_id) return instance.organic_agent_id;
    if (instance?.default_agent_id) return instance.default_agent_id;
  }

  // 5. storedDefault passed by the caller (backward compatibility)
  if (storedDefault?.trim()) return storedDefault.trim();

  // 6. First active tenant agent
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data?.agent_id && typeof data.agent_id === "string") {
    return data.agent_id;
  }

  // 7. Template fallback (always has a real system prompt in memory)
  const templates = buildTemplateAgentsForTenant(tenantId);
  return templates[0]?.id ?? "ag-clara-comercial";
}
