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

export async function updateEvolutionInstanceStateByName(params: {
  instanceName: string;
  connectionState: string;
  waJid?: string | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const patch: Record<string, unknown> = {
    connection_state: params.connectionState,
    updated_at: new Date().toISOString(),
  };
  if (params.waJid !== undefined) patch.wa_jid = params.waJid;
  const { error } = await sb.from("tenant_evolution_instances").update(patch).eq("instance_name", params.instanceName);
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
