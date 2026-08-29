import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function recordAgentRuntimeAlert(params: {
  sb?: SupabaseServiceClient;
  tenantId?: string | null;
  agentId?: string | null;
  code: string;
  severity?: "info" | "warning" | "critical";
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const raw = [params.tenantId ?? "global", params.agentId ?? "none", params.code,
    params.resourceType ?? "none", params.resourceId ?? "none"].join(":");
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  const { error } = await sb.from("agent_runtime_alerts").upsert({
    tenant_id: params.tenantId ?? null,
    agent_id: params.agentId ?? null,
    code: params.code,
    severity: params.severity ?? "warning",
    resource_type: params.resourceType ?? null,
    resource_id: params.resourceId ?? null,
    details: params.details ?? {},
    fingerprint,
    status: "open",
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "fingerprint,status" });
  if (error) console.error("[agent-runtime-alert] persist_failed", { code: params.code, error: error.message });
}
