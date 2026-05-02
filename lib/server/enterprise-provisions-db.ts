/**
 * Acesso a enterprise provisions via Supabase (substitui enterprise-provisions-fs.ts).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { EnterpriseProvisionRecord } from "@/lib/enterprise-provision-types";

type DbProvision = {
  id: string;
  tenant_id: string;
  organization_name: string;
  owner_member_id: string | null;
  owner_email: string;
  owner_name: string;
  notes: string | null;
  max_directors: number | null;
  max_managers: number | null;
  max_sellers: number | null;
  included_agents: number | null;
  max_sales_funnels: number | null;
  monthly_leads_cap: number | null;
  included_whatsapp: number | null;
  created_at: string;
};

function toProvisionRecord(row: DbProvision): EnterpriseProvisionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationName: row.organization_name,
    ownerEmployeeId: row.owner_member_id ?? "",
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    notes: row.notes ?? undefined,
    limits: {
      maxDirectors: row.max_directors ?? null,
      maxManagers: row.max_managers ?? null,
      maxSellers: row.max_sellers ?? null,
      includedAgents: row.included_agents ?? null,
      maxSalesFunnels: row.max_sales_funnels ?? null,
      monthlyAttendedLeadsCap: row.monthly_leads_cap ?? null,
      includedWhatsAppLines: row.included_whatsapp ?? null,
    },
  };
}

export async function readEnterpriseProvisionByTenant(
  tenantId: string,
): Promise<EnterpriseProvisionRecord | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("enterprise_provisions")
    .select("*")
    .eq("tenant_id", tenantId)
    .single();
  if (error || !data) return null;
  return toProvisionRecord(data as DbProvision);
}

export async function readAllEnterpriseProvisions(): Promise<EnterpriseProvisionRecord[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("enterprise_provisions").select("*");
  if (error || !data) return [];
  return (data as DbProvision[]).map(toProvisionRecord);
}

export async function writeEnterpriseProvision(
  provision: EnterpriseProvisionRecord,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("enterprise_provisions").upsert(
    {
      id: provision.id,
      tenant_id: provision.tenantId,
      organization_name: provision.organizationName,
      owner_member_id: provision.ownerEmployeeId || null,
      owner_email: provision.ownerEmail,
      owner_name: provision.ownerName,
      notes: provision.notes ?? null,
      max_directors: provision.limits.maxDirectors ?? null,
      max_managers: provision.limits.maxManagers ?? null,
      max_sellers: provision.limits.maxSellers ?? null,
      included_agents: provision.limits.includedAgents ?? null,
      max_sales_funnels: provision.limits.maxSalesFunnels ?? null,
      monthly_leads_cap: provision.limits.monthlyAttendedLeadsCap ?? null,
      included_whatsapp: provision.limits.includedWhatsAppLines ?? null,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`[enterprise-provisions-db] write: ${error.message}`);
}

export async function upsertTenantForProvision(
  tenantId: string,
  name: string,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("tenants").upsert(
    { id: tenantId, name, billing_plan: "enterprise", status: "ativa" },
    { onConflict: "id" },
  );
  if (error) throw new Error(`[enterprise-provisions-db] upsertTenant: ${error.message}`);
}
