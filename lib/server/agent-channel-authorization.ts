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

type CloudConnectionRuleRow = {
  tenant_id: string;
  active: boolean;
};

export type CloudApiTenantResolution =
  | { ok: true; tenantId: string }
  | {
      ok: false;
      reason:
        | "cloud_connection_not_registered"
        | "cloud_connection_tenant_ambiguous"
        | "cloud_connection_query_failed";
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

/**
 * Resolve o tenant pelo phone_number_id recebido da Cloud API.
 *
 * Regras inativas também identificam a propriedade da conexão para que a
 * mensagem possa ser salva sem autorizar IA. A autorização automática continua
 * dependendo exclusivamente de uma regra ativa em resolveDirectJourneyAgent.
 */
export async function resolveCloudApiTenantByConnection(params: {
  sb: SupabaseServiceClient;
  connectionId: string;
}): Promise<CloudApiTenantResolution> {
  const connectionId = params.connectionId.trim();
  if (!connectionId) return { ok: false, reason: "cloud_connection_not_registered" };

  const { data, error } = await params.sb
    .from("lead_distribution_rules")
    .select("tenant_id, active")
    .in("source", [ORGANIC_WHATSAPP_SOURCE, "whatsapp_api"])
    .eq("transport", "cloud_api")
    .eq("connection_id", connectionId);

  if (error) {
    console.warn("[agent-channel-authorization] cloud_connection_query_failed", {
      connection_id: connectionId,
      error: error.message,
    });
    return { ok: false, reason: "cloud_connection_query_failed" };
  }

  const rows = (data ?? []) as CloudConnectionRuleRow[];
  const activeTenantIds = [
    ...new Set(
      rows
        .filter((row) => row.active)
        .map((row) => row.tenant_id?.trim())
        .filter((tenantId): tenantId is string => Boolean(tenantId)),
    ),
  ];
  const tenantIds =
    activeTenantIds.length > 0
      ? activeTenantIds
      : [
          ...new Set(
            rows
              .map((row) => row.tenant_id?.trim())
              .filter((tenantId): tenantId is string => Boolean(tenantId)),
          ),
        ];
  if (tenantIds.length === 0) {
    return { ok: false, reason: "cloud_connection_not_registered" };
  }
  if (tenantIds.length > 1) {
    console.error("[agent-channel-authorization] cloud_connection_tenant_ambiguous", {
      connection_id: connectionId,
      tenant_count: tenantIds.length,
    });
    return { ok: false, reason: "cloud_connection_tenant_ambiguous" };
  }
  return { ok: true, tenantId: tenantIds[0] };
}

function ruleCanAuthorizeAgent(
  rule: OrganicRuleRow,
  agentId: string,
  connectionId?: string | null,
): boolean {
  if (!AGENT_DISTRIBUTION_TYPES.has(rule.distribution_type ?? "")) return false;
  // A direct WhatsApp rule must name the exact transport. Legacy rules without
  // a connection stay editable, but never authorize every tenant number.
  if (!rule.connection_id || !connectionId || rule.connection_id !== connectionId) return false;
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
  const matchingRules = rules.filter(
    (rule) =>
      AGENT_DISTRIBUTION_TYPES.has(rule.distribution_type ?? "") &&
      Boolean(params.connectionId) &&
      rule.connection_id === params.connectionId &&
      stringArray(rule.agent_ids).length === 1,
  );

  if (preferred) {
    const preferredRules = matchingRules.filter((rule) =>
      stringArray(rule.agent_ids).includes(preferred),
    );
    if (preferredRules.length === 1) {
      return { agentId: preferred, ruleId: preferredRules[0].id };
    }
    if (preferredRules.length > 1) {
      console.error("[agent-channel-authorization] direct_rule_ambiguous", {
        tenant_id: params.tenantId,
        connection_id: params.connectionId ?? null,
        agent_id: preferred,
        rule_count: preferredRules.length,
      });
    }
    return null;
  }

  if (matchingRules.length !== 1) {
    if (matchingRules.length > 1) {
      console.error("[agent-channel-authorization] direct_rule_ambiguous", {
        tenant_id: params.tenantId,
        connection_id: params.connectionId ?? null,
        rule_count: matchingRules.length,
      });
    }
    return null;
  }
  const firstAgent = stringArray(matchingRules[0].agent_ids)[0];
  return firstAgent ? { agentId: firstAgent, ruleId: matchingRules[0].id } : null;
}
