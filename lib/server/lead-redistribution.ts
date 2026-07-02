import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getLeadJourneyById, isJourneyIsolationEnabled } from "@/lib/server/lead-journeys";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type RedistributionTrigger =
  | "agent_unavailable"
  | "delivery_failed"
  | "human_timeout"
  | "customer_silence";

type RedistributionConfig = {
  prazo_minutos?: number;
  quantidade?: number;
  triggers?: Partial<Record<RedistributionTrigger, boolean>>;
  final_destination?: "next_agent" | "human_team" | "crm_only";
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function config(value: unknown): RedistributionConfig {
  return object(value) as RedistributionConfig;
}

export async function scheduleLeadRedistribution(params: {
  sb: ServiceClient;
  tenantId: string;
  journeyId: string | null | undefined;
  ruleId: string | null | undefined;
  currentAgentId?: string | null;
  trigger: RedistributionTrigger;
}): Promise<{ scheduled: boolean; reason: string }> {
  if (!isJourneyIsolationEnabled() || !params.journeyId || !params.ruleId) {
    return { scheduled: false, reason: "journey_or_rule_missing" };
  }

  const { data: rule, error } = await params.sb
    .from("lead_distribution_rules")
    .select("active, redistribution, redistribution_config")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.ruleId)
    .maybeSingle();
  if (error || !rule) return { scheduled: false, reason: "rule_not_found" };

  const row = rule as Record<string, unknown>;
  const settings = config(row.redistribution_config);
  if (row.active !== true || row.redistribution !== true) {
    return { scheduled: false, reason: "redistribution_disabled" };
  }
  if (settings.triggers?.[params.trigger] !== true) {
    return { scheduled: false, reason: "trigger_disabled" };
  }

  const delayMinutes = Math.max(0, Math.min(10080, Number(settings.prazo_minutos ?? 0)));
  const maxAttempts = Math.max(1, Math.min(10, Number(settings.quantidade ?? 3)));
  const scheduledAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  const { data: existing } = await params.sb
    .from("lead_redistribution_jobs")
    .select("id")
    .eq("journey_id", params.journeyId)
    .eq("trigger_type", params.trigger)
    .in("status", ["pending", "processing"])
    .limit(1)
    .maybeSingle();
  if (existing) return { scheduled: false, reason: "already_scheduled" };

  const { error: insertError } = await params.sb
    .from("lead_redistribution_jobs")
    .insert({
      tenant_id: params.tenantId,
      journey_id: params.journeyId,
      rule_id: params.ruleId,
      current_agent_id: params.currentAgentId ?? null,
      trigger_type: params.trigger,
      status: "pending",
      scheduled_at: scheduledAt,
      max_attempts: maxAttempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { scheduled: false, reason: "already_scheduled" };
    }
    console.warn("[lead-redistribution] schedule_failed", {
      tenant_id: params.tenantId,
      journey_id: params.journeyId,
      trigger: params.trigger,
      error: insertError.message,
    });
    return { scheduled: false, reason: "insert_failed" };
  }
  return { scheduled: true, reason: "scheduled" };
}

export async function cancelLeadRedistributionTrigger(params: {
  sb: ServiceClient;
  tenantId: string;
  journeyId: string | null | undefined;
  trigger: RedistributionTrigger;
  reason: string;
}): Promise<void> {
  if (!params.journeyId) return;
  await params.sb
    .from("lead_redistribution_jobs")
    .update({
      status: "cancelled",
      last_error: params.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("journey_id", params.journeyId)
    .eq("trigger_type", params.trigger)
    .eq("status", "pending");
}

async function scheduleHumanTimeoutCandidates(sb: ServiceClient): Promise<void> {
  const { data: rules } = await sb
    .from("lead_distribution_rules")
    .select("id, tenant_id, redistribution_config")
    .eq("active", true)
    .eq("redistribution", true)
    .limit(500);
  const eligibleRules = ((rules ?? []) as Array<Record<string, unknown>>).filter(
    (rule) => config(rule.redistribution_config).triggers?.human_timeout === true,
  );
  if (eligibleRules.length === 0) return;

  for (const rule of eligibleRules) {
    const { data: journeys } = await sb
      .from("lead_journeys")
      .select("id, tenant_id, agent_id")
      .eq("tenant_id", rule.tenant_id)
      .eq("rule_id", rule.id)
      .eq("status", "active")
      .limit(100);
    const journeyIds = (journeys ?? []).map((journey) => String(journey.id));
    if (journeyIds.length === 0) continue;
    const { data: states } = await sb
      .from("conversation_states")
      .select("active_journey_id")
      .eq("tenant_id", rule.tenant_id)
      .eq("human_paused", true)
      .in("active_journey_id", journeyIds);
    const waiting = new Set((states ?? []).map((state) => String(state.active_journey_id)));
    for (const journey of (journeys ?? []) as Array<Record<string, unknown>>) {
      if (!waiting.has(String(journey.id))) continue;
      await scheduleLeadRedistribution({
        sb,
        tenantId: String(rule.tenant_id),
        journeyId: String(journey.id),
        ruleId: String(rule.id),
        currentAgentId: typeof journey.agent_id === "string" ? journey.agent_id : null,
        trigger: "human_timeout",
      });
    }
  }
}

async function processJob(sb: ServiceClient, raw: Record<string, unknown>) {
  const id = String(raw.id);
  const tenantId = String(raw.tenant_id);
  const journeyId = String(raw.journey_id);
  const attempts = Number(raw.attempts ?? 0) + 1;
  const maxAttempts = Number(raw.max_attempts ?? 3);

  const { data: claimed } = await sb
    .from("lead_redistribution_jobs")
    .update({ status: "processing", attempts, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { processed: false, outcome: "claim_lost" };

  const journey = await getLeadJourneyById({ sb, tenantId, journeyId });
  if (!journey || journey.status !== "active") {
    await sb
      .from("lead_redistribution_jobs")
      .update({ status: "cancelled", last_error: "journey_not_active", updated_at: new Date().toISOString() })
      .eq("id", id);
    return { processed: true, outcome: "journey_not_active" };
  }

  const { data: rule } = await sb
    .from("lead_distribution_rules")
    .select("active, agent_ids, employee_ids, redistribution, redistribution_config")
    .eq("tenant_id", tenantId)
    .eq("id", journey.ruleId ?? raw.rule_id)
    .maybeSingle();
  const ruleRow = (rule ?? {}) as Record<string, unknown>;
  if (ruleRow.active !== true || ruleRow.redistribution !== true) {
    await sb
      .from("lead_redistribution_jobs")
      .update({ status: "cancelled", last_error: "rule_disabled", updated_at: new Date().toISOString() })
      .eq("id", id);
    return { processed: true, outcome: "rule_disabled" };
  }

  const agentIds = stringArray(ruleRow.agent_ids).filter((agentId) => agentId !== journey.agentId);
  let nextAgentId: string | null = null;
  if (agentIds.length > 0) {
    const { data: agents } = await sb
      .from("tenant_agents")
      .select("agent_id, active, metadata")
      .eq("tenant_id", tenantId)
      .in("agent_id", agentIds);
    nextAgentId =
      ((agents ?? []) as Array<Record<string, unknown>>).find((agent) => {
        const metadata = object(agent.metadata);
        const status = typeof metadata.status === "string" ? metadata.status.toLowerCase() : "";
        return agent.active === true && !["pausado", "inativo"].includes(status);
      })?.agent_id as string | undefined ?? null;
  }

  const settings = config(ruleRow.redistribution_config);
  const finalDestination = settings.final_destination ?? "next_agent";
  if (nextAgentId) {
    const now = new Date().toISOString();
    await Promise.all([
      sb
        .from("lead_journeys")
        .update({ agent_id: nextAgentId, updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("id", journeyId)
        .eq("status", "active"),
      sb
        .from("conversation_states")
        .update({ agent_id: nextAgentId, updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("active_journey_id", journeyId),
      journey.leadId
        ? sb
            .from("leads")
            .update({ agent_id: nextAgentId, agent_assignment_source: "rule_redistribution", updated_at: now })
            .eq("tenant_id", tenantId)
            .eq("id", journey.leadId)
        : Promise.resolve(),
      sb
        .from("agent_response_jobs")
        .update({ status: "cancelled", failed_reason: "journey_redistributed", updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .eq("status", "pending"),
      sb
        .from("follow_up_jobs")
        .update({ status: "cancelled", last_error: "journey_redistributed", updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .eq("status", "pending"),
    ]);
    await sb
      .from("lead_redistribution_jobs")
      .update({ status: "completed", completed_at: now, last_error: null, updated_at: now })
      .eq("id", id);
    console.info("[lead-redistribution] reassigned", {
      tenant_id: tenantId,
      journey_id: journeyId,
      from_agent_id: journey.agentId,
      to_agent_id: nextAgentId,
    });
    return { processed: true, outcome: "reassigned" };
  }

  if (finalDestination === "human_team" || finalDestination === "crm_only") {
    const now = new Date().toISOString();
    const status = finalDestination === "human_team" ? "manual_review" : "closed";
    await Promise.all([
      sb
        .from("lead_journeys")
        .update({ status, ended_at: finalDestination === "crm_only" ? now : null, updated_at: now })
        .eq("tenant_id", tenantId)
        .eq("id", journeyId),
      sb
        .from("conversation_states")
        .update({
          active_journey_id: null,
          agent_id: null,
          conversation_mode: finalDestination === "human_team" ? "waiting_human" : "manual",
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("active_journey_id", journeyId),
    ]);
    await sb
      .from("lead_redistribution_jobs")
      .update({ status: "completed", completed_at: now, last_error: finalDestination, updated_at: now })
      .eq("id", id);
    return { processed: true, outcome: finalDestination };
  }

  const terminal = attempts >= maxAttempts;
  await sb
    .from("lead_redistribution_jobs")
    .update({
      status: terminal ? "failed" : "pending",
      scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      last_error: "no_eligible_agent_in_rule",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return { processed: true, outcome: terminal ? "failed" : "retry" };
}

export async function processDueLeadRedistributions(
  sb: ServiceClient,
  limit = 25,
): Promise<{ processed: number; outcomes: Record<string, number> }> {
  if (!isJourneyIsolationEnabled()) return { processed: 0, outcomes: {} };
  await scheduleHumanTimeoutCandidates(sb);
  const { data, error } = await sb
    .from("lead_redistribution_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) throw new Error(`[lead-redistribution] due_query: ${error.message}`);

  const outcomes: Record<string, number> = {};
  let processed = 0;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const result = await processJob(sb, row);
    if (!result.processed) continue;
    processed += 1;
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  }
  return { processed, outcomes };
}
