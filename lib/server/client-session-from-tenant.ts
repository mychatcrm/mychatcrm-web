import "server-only";

import {
  makeInitials,
  registerLiveClientSession,
  type ClientAccountStatus,
  type ClientPlan,
  type ClientSession,
} from "@/lib/client-auth";
import { hierarchyRoleToOrganizationRole } from "@/lib/organization-hierarchy";
import { normalizeToPlan } from "@/lib/plan-policy";
import { enterpriseLimitsToPlanLimits } from "@/lib/enterprise-provision-limits";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { readEnterpriseProvisionByTenant } from "@/lib/server/enterprise-provisions-db";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { tenantPlanDefaults } from "@/lib/tenant-session-defaults";
import type { TeamEmployee } from "@/lib/team-employees-types";

const PLAN_LABELS: Record<ClientPlan, ClientSession["planLabel"]> = {
  solo: "Solo",
  equipa: "Equipa",
  escala: "Escala",
  enterprise: "Enterprise",
};

type DbTenant = {
  id: string;
  name: string | null;
  billing_plan?: string | null;
  status?: string | null;
};

type DbMember = {
  id: string;
  tenant_id: string;
  nome: string;
  email: string;
  funcao: string;
  hierarchy_role: TeamEmployee["hierarchyRole"];
  reports_to_id: string | null;
  ativo: boolean;
  account_suspended: boolean;
};

function dbMemberToEmployee(row: DbMember): TeamEmployee {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    funcao: row.funcao,
    initialPassword: "",
    hasInitialPassword: false,
    ativo: row.ativo,
    hierarchyRole: row.hierarchy_role,
    reportsToId: row.reports_to_id ?? undefined,
    accountSuspended: row.account_suspended,
  };
}

function normalizeTenantStatus(status: string | null | undefined): ClientAccountStatus {
  const value = (status ?? "ativa").toLowerCase();
  if (value === "cancelada" || value === "canceled" || value === "cancelled") return "cancelada";
  return "ativa";
}

async function readTenantFromDb(tenantId: string): Promise<DbTenant | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenants")
    .select("id,name,billing_plan,status")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("[client-session-from-tenant] read tenant:", error.message);
    return null;
  }
  return (data as DbTenant | null) ?? null;
}

async function readTenantMemberById(tenantId: string, memberId: string): Promise<TeamEmployee | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_members")
    .select("id,tenant_id,nome,email,funcao,hierarchy_role,reports_to_id,ativo,account_suspended")
    .eq("tenant_id", tenantId)
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    console.error("[client-session-from-tenant] read member:", error.message);
    return null;
  }
  if (!data) return null;
  return dbMemberToEmployee(data as DbMember);
}

function resolveEmployeeForSession(
  members: TeamEmployee[],
  preferredEmployeeId?: string,
  ownerEmployeeId?: string,
): TeamEmployee | null {
  const active = members.filter((m) => m.ativo && !m.accountSuspended);
  if (!active.length) return null;

  let employee = preferredEmployeeId ? active.find((m) => m.id === preferredEmployeeId) : undefined;
  if (!employee && ownerEmployeeId) {
    employee = active.find((m) => m.id === ownerEmployeeId);
  }
  if (!employee) {
    employee = active.find((m) => m.hierarchyRole === "director") ?? active[0];
  }
  return employee ?? null;
}

/**
 * Reconstrói sessão cliente a partir do tenant no Supabase (retorno OAuth Meta sem cookie).
 * Compatível com o formato devolvido por `getClientSessionByToken`.
 */
export async function buildClientSessionForTenant(
  tenantId: string,
  employeeId?: string,
): Promise<ClientSession | null> {
  const tenant = await readTenantFromDb(tenantId);
  if (!tenant) return null;

  const ent = await readEnterpriseProvisionByTenant(tenantId);
  const isEnterpriseTenant = Boolean(ent);

  let employee: TeamEmployee | null = null;
  if (employeeId) {
    employee = await readTenantMemberById(tenantId, employeeId);
    if (employee && (!employee.ativo || employee.accountSuspended)) {
      employee = null;
    }
  }

  const members = employee ? [employee] : await readTeamMembersFromDb(tenantId);
  if (!employee) {
    employee = resolveEmployeeForSession(members, employeeId, ent?.ownerEmployeeId);
  }
  if (!employee) return null;

  const planSlug = tenant.billing_plan ?? undefined;
  const meta = tenantPlanDefaults(tenantId);
  const plan = isEnterpriseTenant
    ? ("enterprise" as const)
    : (normalizeToPlan(planSlug ?? meta.plan) as ClientPlan);
  const planLabel = PLAN_LABELS[plan];
  const companyName =
    (tenant.name?.trim() || undefined) ??
    (isEnterpriseTenant && ent ? ent.organizationName : meta.companyName);
  const operationalLimits =
    isEnterpriseTenant && ent ? enterpriseLimitsToPlanLimits(ent.limits) : undefined;
  const organizationRole =
    isEnterpriseTenant && ent && employee.id === ent.ownerEmployeeId
      ? ("owner" as const)
      : hierarchyRoleToOrganizationRole(employee.hierarchyRole);

  return registerLiveClientSession({
    tenantId,
    email: employee.email,
    displayName: employee.nome,
    companyName,
    plan,
    planLabel,
    initials: makeInitials(employee.nome),
    status: normalizeTenantStatus(tenant.status),
    organizationRole,
    employeeId: employee.id,
    reportsToEmployeeId: employee.reportsToId,
    accountSuspended: false,
    operationalLimits,
  });
}
