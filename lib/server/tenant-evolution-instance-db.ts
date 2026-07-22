import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type TenantEvolutionInstanceRow = {
  id: string;
  tenant_id: string;
  slot_index: number;
  instance_name: string;
  connection_state: string;
  wa_jid: string | null;
  default_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

export const EVOLUTION_LIFECYCLE_STATES = ["provisioning", "deleting", "resetting"] as const;
export type EvolutionLifecycleState = (typeof EVOLUTION_LIFECYCLE_STATES)[number];

export function isEvolutionLifecycleState(value: string | null | undefined): value is EvolutionLifecycleState {
  return EVOLUTION_LIFECYCLE_STATES.includes(value as EvolutionLifecycleState);
}

export async function getEvolutionInstanceByTenantSlot(
  tenantId: string,
  slotIndex: number,
): Promise<TenantEvolutionInstanceRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex)
    .maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] select slot: ${error.message}`);
  return (data as TenantEvolutionInstanceRow) ?? null;
}

export async function getEvolutionInstanceByName(
  instanceName: string,
): Promise<TenantEvolutionInstanceRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("*")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] select name: ${error.message}`);
  return (data as TenantEvolutionInstanceRow) ?? null;
}

/** Exact transport lookup for flows whose rule selected a specific QR connection. */
export async function getEvolutionInstanceByIdForTenant(
  tenantId: string,
  connectionId: string,
): Promise<TenantEvolutionInstanceRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] select connection: ${error.message}`);
  return (data as TenantEvolutionInstanceRow) ?? null;
}

export async function upsertTenantEvolutionInstance(params: {
  tenantId: string;
  slotIndex: number;
  instanceName: string;
  connectionState: string;
  waJid?: string | null;
  defaultAgentId?: string | null;
}): Promise<TenantEvolutionInstanceRow> {
  const sb = createSupabaseServiceClient();
  const payload = {
    tenant_id: params.tenantId,
    slot_index: params.slotIndex,
    instance_name: params.instanceName,
    connection_state: params.connectionState,
    wa_jid: params.waJid ?? null,
    default_agent_id: params.defaultAgentId ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .upsert(payload, { onConflict: "tenant_id,slot_index" })
    .select("*")
    .single();
  if (error) throw new Error(`[tenant-evolution-instance-db] upsert: ${error.message}`);
  return data as TenantEvolutionInstanceRow;
}

export async function reserveTenantEvolutionInstance(params: {
  tenantId: string;
  slotIndex: number;
  instanceName: string;
  defaultAgentId?: string | null;
}): Promise<{ reserved: boolean; row: TenantEvolutionInstanceRow }> {
  const sb = createSupabaseServiceClient();
  const payload = {
    tenant_id: params.tenantId,
    slot_index: params.slotIndex,
    instance_name: params.instanceName,
    connection_state: "provisioning",
    wa_jid: null,
    default_agent_id: params.defaultAgentId ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .insert(payload)
    .select("*")
    .single();

  if (!error && data) {
    return { reserved: true, row: data as TenantEvolutionInstanceRow };
  }
  if (error?.code !== "23505") {
    throw new Error(`[tenant-evolution-instance-db] reserve: ${error?.message ?? "unknown_error"}`);
  }

  const existing = await getEvolutionInstanceByTenantSlot(params.tenantId, params.slotIndex);
  if (!existing) {
    throw new Error("[tenant-evolution-instance-db] reserve conflict without existing slot");
  }
  return { reserved: false, row: existing };
}

export async function finalizeTenantEvolutionInstanceReservation(params: {
  tenantId: string;
  slotIndex: number;
  instanceName: string;
  connectionState: string;
  waJid?: string | null;
}): Promise<TenantEvolutionInstanceRow> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .update({
      connection_state: params.connectionState,
      wa_jid: params.waJid ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("slot_index", params.slotIndex)
    .eq("instance_name", params.instanceName)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] finalize reservation: ${error.message}`);
  if (!data) throw new Error("[tenant-evolution-instance-db] reservation no longer owns slot");
  return data as TenantEvolutionInstanceRow;
}

/** Atomically claims an existing tenant/slot row for one lifecycle operation. */
export async function claimTenantEvolutionInstanceLifecycle(params: {
  tenantId: string;
  slotIndex: number;
  instanceName: string;
  expectedConnectionState: string;
  expectedUpdatedAt?: string;
  lifecycleState: EvolutionLifecycleState;
}): Promise<TenantEvolutionInstanceRow | null> {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from("tenant_evolution_instances")
    .update({
      connection_state: params.lifecycleState,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("slot_index", params.slotIndex)
    .eq("instance_name", params.instanceName)
    .eq("connection_state", params.expectedConnectionState);
  if (params.expectedUpdatedAt) query = query.eq("updated_at", params.expectedUpdatedAt);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] claim lifecycle: ${error.message}`);
  return (data as TenantEvolutionInstanceRow) ?? null;
}

/**
 * Completes a verified remote removal while preserving the logical row UUID.
 * The lifecycle state and old instance name form the compare-and-set guard.
 */
export async function finalizeTenantEvolutionInstanceRemoval(params: {
  tenantId: string;
  slotIndex: number;
  previousInstanceName: string;
  lifecycleState: Extract<EvolutionLifecycleState, "deleting" | "resetting">;
  nextInstanceName: string;
}): Promise<TenantEvolutionInstanceRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .update({
      instance_name: params.nextInstanceName,
      connection_state: "close",
      wa_jid: null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("slot_index", params.slotIndex)
    .eq("instance_name", params.previousInstanceName)
    .eq("connection_state", params.lifecycleState)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] finalize removal: ${error.message}`);
  return (data as TenantEvolutionInstanceRow) ?? null;
}

export async function updateEvolutionInstanceStateByName(params: {
  instanceName: string;
  connectionState: string;
  waJid?: string | null;
  /** Ignore remote status events while a local delete/reset/provision operation owns the slot. */
  preserveLifecycle?: boolean;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const patch: Record<string, unknown> = {
    connection_state: params.connectionState,
    updated_at: new Date().toISOString(),
  };
  if (params.waJid !== undefined) patch.wa_jid = params.waJid;
  let query = sb.from("tenant_evolution_instances").update(patch).eq("instance_name", params.instanceName);
  if (params.preserveLifecycle && !isEvolutionLifecycleState(params.connectionState)) {
    query = query.not("connection_state", "in", `(${EVOLUTION_LIFECYCLE_STATES.join(",")})`);
  }
  const { error } = await query;
  if (error) throw new Error(`[tenant-evolution-instance-db] update state: ${error.message}`);
}

/** Retorna a primeira instância activa do tenant (slot 0 ou a mais recente). */
export async function getEvolutionInstanceByTenantId(
  tenantId: string,
): Promise<TenantEvolutionInstanceRow | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("slot_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`[tenant-evolution-instance-db] select tenant: ${error.message}`);
  return (data as TenantEvolutionInstanceRow) ?? null;
}

/** Página estável de sessões abertas para reconciliação interna de saúde. */
export async function listOpenEvolutionInstances(params?: {
  afterId?: string | null;
  limit?: number;
}): Promise<TenantEvolutionInstanceRow[]> {
  const sb = createSupabaseServiceClient();
  const limit = Math.max(1, Math.min(100, Math.trunc(params?.limit ?? 50)));
  let query = sb
    .from("tenant_evolution_instances")
    .select("*")
    .eq("connection_state", "open")
    .order("id", { ascending: true })
    .limit(limit);
  if (params?.afterId) query = query.gt("id", params.afterId);
  const { data, error } = await query;
  if (error) throw new Error(`[tenant-evolution-instance-db] list open: ${error.message}`);
  return (data ?? []) as TenantEvolutionInstanceRow[];
}

export async function deleteTenantEvolutionInstanceRow(tenantId: string, slotIndex: number): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("tenant_evolution_instances").delete().eq("tenant_id", tenantId).eq("slot_index", slotIndex);
  if (error) throw new Error(`[tenant-evolution-instance-db] delete: ${error.message}`);
}

export async function deleteTenantEvolutionInstanceRowIfName(
  tenantId: string,
  slotIndex: number,
  instanceName: string,
): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_evolution_instances")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("slot_index", slotIndex)
    .eq("instance_name", instanceName)
    .select("id");
  if (error) throw new Error(`[tenant-evolution-instance-db] conditional delete: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}
