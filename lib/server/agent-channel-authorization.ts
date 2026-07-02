import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { stringArray } from "@/lib/server/meta-form-authorization";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const ORGANIC_WHATSAPP_SOURCE = "whatsapp_organico";
const AGENT_DISTRIBUTION_TYPES = new Set([
  "automation_agent",
  "specific_agents",
  "round_robin",
  "all_agents",
]);

type OrganicRuleRow = {
  id: string;
  distribution_type: string | null;
  agent_ids: unknown;
  order_index: number | null;
  connection_id: string | null;
};

export function isDirectWhatsAppAutomationTrigger(triggerSource: string): boolean {
  const normalized = triggerSource.toLowerCase();
  return (
    normalized.includes("evolution") ||
    normalized.includes("whatsapp_cloud") ||
    normalized.includes("agent_response_job") ||
    normalized.includes("follow_up") ||
    normalized.includes("return_automation")
  );
}

async function loadActiveOrganicWhatsAppRules(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<OrganicRuleRow[]> {
  const { data, error } = await sb
    .from("lead_distribution_rules")
    .select("id, distribution_type, agent_ids, order_index, connection_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("source", ORGANIC_WHATSAPP_SOURCE)
    .order("order_index", { ascending: true });

  if (error) {
    console.warn("[agent-channel-authorization] organic_rules_query_failed", {
      tenant_id: tenantId,
      error: error.message,
    });
    return [];
  }

  return (data ?? []) as OrganicRuleRow[];
}

function ruleCanAuthorizeAgent(
  rule: OrganicRuleRow,
  agentId: string,
  connectionId?: string | null,
): boolean {
  if (!AGENT_DISTRIBUTION_TYPES.has(rule.distribution_type ?? "")) return false;
  if (rule.connection_id && rule.connection_id !== connectionId) return false;
  return stringArray(rule.agent_ids).includes(agentId);
}

export async function isAgentAuthorizedForDirectWhatsApp(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  agentId: string;
  ruleId?: string | null;
  connectionId?: string | null;
}): Promise<boolean> {
  const agentId = params.agentId.trim();
  if (!agentId) return false;

  const rules = await loadActiveOrganicWhatsAppRules(params.sb, params.tenantId);
  return rules.some(
    (rule) =>
      (!params.ruleId || rule.id === params.ruleId) &&
      ruleCanAuthorizeAgent(rule, agentId, params.connectionId),
  );
}

export async function resolveDirectWhatsAppAgentFromRules(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  preferredAgentId?: string | null;
  connectionId?: string | null;
}): Promise<{ agentId: string; ruleId: string } | null> {
  const preferred = params.preferredAgentId?.trim() || null;
  const rules = await loadActiveOrganicWhatsAppRules(params.sb, params.tenantId);

  for (const rule of rules) {
    if (!AGENT_DISTRIBUTION_TYPES.has(rule.distribution_type ?? "")) continue;
    if (rule.connection_id && rule.connection_id !== params.connectionId) continue;
    const agentIds = stringArray(rule.agent_ids);
    if (preferred) {
      if (agentIds.includes(preferred)) return { agentId: preferred, ruleId: rule.id };
      continue;
    }
    const firstAgent = agentIds[0];
    if (firstAgent) return { agentId: firstAgent, ruleId: rule.id };
  }

  return null;
}
