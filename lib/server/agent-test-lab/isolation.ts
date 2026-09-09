import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_OWNER_ID } from "@/lib/agent-test-lab/policy";
import { buildLabIsolatedCopy, type LabIsolatedCopy } from "@/lib/agent-test-lab/isolation-policy";
import { labAudit } from "./auth";

/**
 * The laboratory tenant lives outside public.tenants, exactly like
 * tenant-system-internal already does. There is no foreign key to satisfy, and
 * keeping it out means platform metrics and the customer list never count it.
 */
export const LAB_TENANT_PREFIX = "tenant-lab-";
export const labTenantIdFor = (sourceTenantId: string, sourceAgentId: string) =>
  `${LAB_TENANT_PREFIX}${createHash("sha256").update(`${sourceTenantId}:${sourceAgentId}`).digest("hex").slice(0, 12)}`;

export type LabIsolatedAgent = {
  id: string; labTenantId: string; labAgentId: string;
  sourceTenantId: string; sourceAgentId: string;
  unavailable: LabIsolatedCopy["unavailable"]; withheld: string[]; stale: boolean;
};

/**
 * Copies one agent's prompts and behaviour into the laboratory tenant. Credentials,
 * customer records and third-party numbers are left behind by allowlist, and every
 * dependency the copy cannot honestly provide is recorded so a run can refuse to
 * approve it later.
 */
export async function provisionLabIsolatedAgent(sourceTenantId: string, sourceAgentId: string): Promise<LabIsolatedAgent> {
  const sb = createSupabaseServiceClient();
  const source = await sb.from("tenant_agents")
    .select("display_name,system_prompt,model,metadata,voice_id,response_mode,config_version,crm_auto_move_enabled,active,archived_at")
    .eq("tenant_id", sourceTenantId).eq("agent_id", sourceAgentId).maybeSingle();
  if (source.error) throw new Error("isolated_source_read_failed");
  if (!source.data || !source.data.active || source.data.archived_at) throw new Error("isolated_source_unavailable");

  const metadata = (source.data.metadata ?? {}) as Record<string, unknown>;
  const copy = buildLabIsolatedCopy({
    metadata,
    crmAutoMoveEnabled: source.data.crm_auto_move_enabled,
    agendaAutomationEnabled: metadata.agendaAutomationEnabled === true,
  });
  const labTenantId = labTenantIdFor(sourceTenantId, sourceAgentId);
  const labAgentId = `lab-${sourceAgentId}`.slice(0, 100);
  const sourceConfigHash = createHash("sha256")
    .update(JSON.stringify({ prompt: source.data.system_prompt, metadata: copy.metadata, version: source.data.config_version }))
    .digest("hex");

  // The copy carries no history, no leads and no connection of its own: it is the
  // configuration only. CRM columns are deliberately left null.
  const upserted = await sb.from("tenant_agents").upsert({
    tenant_id: labTenantId, agent_id: labAgentId,
    display_name: `[LAB] ${String(source.data.display_name ?? sourceAgentId)}`.slice(0, 150),
    system_prompt: source.data.system_prompt, model: source.data.model,
    metadata: { ...copy.metadata, tenantId: labTenantId, agentId: labAgentId },
    voice_id: source.data.voice_id, response_mode: source.data.response_mode,
    crm_auto_move_enabled: false, crm_target_funnel_id: null, crm_target_column_id: null, crm_target_status: null,
    active: true, archived_at: null, source_template: "agent_test_lab_copy",
  }, { onConflict: "tenant_id,agent_id" });
  if (upserted.error) throw new Error("isolated_copy_save_failed");

  const registered = await sb.from("agent_test_lab_isolated_agents").upsert({
    owner_admin_id: LAB_OWNER_ID, lab_tenant_id: labTenantId, lab_agent_id: labAgentId,
    source_tenant_id: sourceTenantId, source_agent_id: sourceAgentId,
    source_config_hash: sourceConfigHash, unavailable_dependencies: copy.unavailable, archived_at: null,
  }, { onConflict: "lab_tenant_id,lab_agent_id" }).select("id").single();
  if (registered.error || !registered.data) throw new Error("isolated_registry_save_failed");

  await labAudit("isolation.provisioned", String(registered.data.id));
  return {
    id: String(registered.data.id), labTenantId, labAgentId, sourceTenantId, sourceAgentId,
    unavailable: copy.unavailable, withheld: copy.withheld, stale: false,
  };
}

/** Reports whether an existing copy still matches the agent it was taken from. */
export async function inspectLabIsolatedAgent(sourceTenantId: string, sourceAgentId: string): Promise<LabIsolatedAgent | null> {
  const sb = createSupabaseServiceClient();
  const row = await sb.from("agent_test_lab_isolated_agents")
    .select("id,lab_tenant_id,lab_agent_id,source_config_hash,unavailable_dependencies")
    .eq("owner_admin_id", LAB_OWNER_ID).eq("source_tenant_id", sourceTenantId)
    .eq("source_agent_id", sourceAgentId).is("archived_at", null).maybeSingle();
  if (row.error) throw new Error("isolated_registry_read_failed");
  if (!row.data) return null;

  const source = await sb.from("tenant_agents").select("system_prompt,metadata,config_version,crm_auto_move_enabled")
    .eq("tenant_id", sourceTenantId).eq("agent_id", sourceAgentId).maybeSingle();
  if (source.error) throw new Error("isolated_source_read_failed");
  const metadata = (source.data?.metadata ?? {}) as Record<string, unknown>;
  const copy = buildLabIsolatedCopy({ metadata, crmAutoMoveEnabled: source.data?.crm_auto_move_enabled });
  const currentHash = createHash("sha256")
    .update(JSON.stringify({ prompt: source.data?.system_prompt, metadata: copy.metadata, version: source.data?.config_version }))
    .digest("hex");

  return {
    id: String(row.data.id), labTenantId: String(row.data.lab_tenant_id), labAgentId: String(row.data.lab_agent_id),
    sourceTenantId, sourceAgentId, withheld: copy.withheld,
    unavailable: (row.data.unavailable_dependencies ?? []) as LabIsolatedCopy["unavailable"],
    // A configuration change invalidates the copy: a result belongs to the exact
    // configuration it was produced from, never to a later one.
    stale: currentHash !== String(row.data.source_config_hash),
  };
}
