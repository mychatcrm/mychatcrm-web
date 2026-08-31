import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AgentRuntimeMetricName =
  | "runtime_health_check"
  | "webhook_latency"
  | "provider_call"
  | "agenda_action"
  | "follow_up"
  | "agenda_reminder"
  | "authorization"
  | "retry"
  | "duplicate";

export type AgentRuntimeMetricSubsystem =
  | "runtime"
  | "evolution"
  | "meta_cloud"
  | "agenda"
  | "agenda_reminder"
  | "follow_up"
  | "outbox"
  | "external_api";

export type AgentRuntimeMetricOutcome =
  | "success"
  | "blocked"
  | "retry"
  | "duplicate"
  | "failed"
  | "pending"
  | "sent"
  | "cancelled";

/**
 * Best-effort aggregate metric. Observability can never roll back a customer
 * action and the RPC stores only bounded counters/durations — no tenant,
 * telephone, prompt, message, token or provider payload.
 */
export async function recordAgentRuntimeMetric(params: {
  metric: AgentRuntimeMetricName;
  subsystem: AgentRuntimeMetricSubsystem;
  outcome: AgentRuntimeMetricOutcome;
  durationMs?: number | null;
  count?: number;
  sb?: SupabaseServiceClient;
}): Promise<void> {
  try {
    const sb = params.sb ?? createSupabaseServiceClient();
    await sb.rpc("record_agent_runtime_metric_v1", {
      p_metric_name: params.metric,
      p_subsystem: params.subsystem,
      p_outcome: params.outcome,
      p_duration_ms: params.durationMs == null
        ? null
        : Math.max(0, Math.min(3_600_000, Math.round(params.durationMs))),
      p_count: Math.max(1, Math.min(100_000, Math.round(params.count ?? 1))),
    });
  } catch {
    // Metrics are deliberately non-authoritative.
  }
}
