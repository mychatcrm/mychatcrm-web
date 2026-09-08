import "server-only";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { agentProtectionDescription, safeProtectionCode } from "@/lib/agent-protection";

export async function recordAgentProtectionBlock(params: {
  tenantId: string; agentId: string; jobId: string; generation: number;
  channel: string; code: string; leadId?: string | null;
}): Promise<void> {
  const code = safeProtectionCode(params.code);
  const description = agentProtectionDescription(code);
  await appendOperationalAuditEvent({
    tenantId: params.tenantId, actorType: "agent", actorId: params.agentId,
    module: "agent.protection", action: "guard.triggered", status: "blocked",
    severity: description.expected ? "info" : "warning",
    resourceType: "agent_response_jobs", resourceId: params.jobId,
    channel: params.channel, resultCode: code,
    idempotencyKey: `guard:${params.jobId}:${params.generation}:${code}`,
    relatedIds: { job_id: params.jobId, agent_id: params.agentId, lead_id: params.leadId },
    metadata: { expectedProtection: description.expected, generation: params.generation },
  });
}
