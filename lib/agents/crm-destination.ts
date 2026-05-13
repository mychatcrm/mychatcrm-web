import type { Agent } from "@/lib/types";

export type AgentCrmDestinationInput = Pick<
  Agent,
  "crmAutoMoveEnabled" | "crmTargetFunnelId" | "crmTargetColumnId" | "crmTargetStatus"
>;

export type NormalizedAgentCrmDestination = {
  crmAutoMoveEnabled: boolean;
  crmTargetFunnelId: string | null;
  crmTargetColumnId: string | null;
  crmTargetStatus: string | null;
};

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeAgentCrmDestination(
  input: Partial<AgentCrmDestinationInput>,
): NormalizedAgentCrmDestination {
  const enabled = Boolean(input.crmAutoMoveEnabled);
  if (!enabled) {
    return {
      crmAutoMoveEnabled: false,
      crmTargetFunnelId: null,
      crmTargetColumnId: null,
      crmTargetStatus: null,
    };
  }

  const targetColumn = cleanText(input.crmTargetColumnId) ?? cleanText(input.crmTargetStatus);
  return {
    crmAutoMoveEnabled: true,
    crmTargetFunnelId: cleanText(input.crmTargetFunnelId),
    crmTargetColumnId: targetColumn,
    crmTargetStatus: targetColumn,
  };
}

export function validateAgentCrmDestination(input: Partial<AgentCrmDestinationInput>): string | null {
  const normalized = normalizeAgentCrmDestination(input);
  if (!normalized.crmAutoMoveEnabled) return null;
  if (!normalized.crmTargetFunnelId) return "Escolha um funil em «Destino do lead no CRM».";
  if (!normalized.crmTargetColumnId) return "Escolha uma coluna em «Destino do lead no CRM».";
  return null;
}

export function agentCrmDestinationDbFields(input: Partial<AgentCrmDestinationInput>): Record<string, unknown> {
  const normalized = normalizeAgentCrmDestination(input);
  return {
    crm_auto_move_enabled: normalized.crmAutoMoveEnabled,
    crm_target_funnel_id: normalized.crmTargetFunnelId,
    crm_target_column_id: normalized.crmTargetColumnId,
    crm_target_status: normalized.crmTargetStatus,
  };
}
