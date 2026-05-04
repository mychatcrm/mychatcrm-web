/**
 * Acesso a colaboradores via Supabase (substitui team-employees-fs.ts).
 * Usa service_role para bypass de RLS — código servidor apenas.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { TeamEmployee } from "@/lib/team-employees-types";

type DbMember = {
  id: string;
  tenant_id: string;
  nome: string;
  email: string;
  password_hash: string;
  funcao: string;
  hierarchy_role: "director" | "manager" | "seller";
  reports_to_id: string | null;
  ativo: boolean;
  account_suspended: boolean;
};

function toTeamEmployee(row: DbMember): TeamEmployee {
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

export async function readTeamMembersFromDb(tenantId: string): Promise<TeamEmployee[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_members")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[team-employees-db] readTeamMembers:", error.message);
    return [];
  }
  return (data as DbMember[]).map(toTeamEmployee);
}

export async function findTeamMemberCredentials(
  emailLc: string,
  password: string,
): Promise<{ tenantId: string; employee: TeamEmployee } | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_members")
    .select("*")
    .eq("email", emailLc)
    .eq("ativo", true)
    .eq("account_suspended", false)
    .single();

  if (error || !data) return null;

  const row = data as DbMember & { tenant_id: string };

  // Verificar senha com pgcrypto (crypt)
  const { data: check, error: checkErr } = await sb
    .rpc("verify_member_password", { member_id: row.id, plain_password: password });

  if (checkErr || !check) return null;

  return { tenantId: row.tenant_id, employee: toTeamEmployee(row) };
}

export async function teamMemberEmailExistsInDb(emailLc: string): Promise<boolean> {
  // Delega na função central que é fail-closed.
  // Retorna true tanto quando o e-mail existe quanto quando o Supabase falha
  // (conservador: evita criar duplicatas em caso de erro).
  const { checkEmailAvailability } = await import("@/lib/server/email-availability");
  const result = await checkEmailAvailability(emailLc);
  if (!result.ok) return true; // fail-closed: tratar erro como "já existe"
  return !result.available;
}

export async function writeTeamMemberToDb(
  tenantId: string,
  employee: TeamEmployee & { plainPassword: string },
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.rpc("upsert_tenant_member", {
    p_id: employee.id,
    p_tenant_id: tenantId,
    p_nome: employee.nome,
    p_email: employee.email.toLowerCase(),
    p_password: employee.plainPassword,
    p_funcao: employee.funcao,
    p_hierarchy_role: employee.hierarchyRole,
    p_reports_to_id: employee.reportsToId ?? null,
    p_ativo: employee.ativo,
    p_account_suspended: employee.accountSuspended ?? false,
  });
  if (error) throw new Error(`[team-employees-db] write: ${error.message}`);
}

export async function updateTeamMemberProfileInDb(
  id: string,
  fields: { nome?: string; email?: string; funcao?: string; accountSuspended?: boolean },
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.nome !== undefined) patch.nome = fields.nome;
  if (fields.email !== undefined) patch.email = fields.email.toLowerCase();
  if (fields.funcao !== undefined) patch.funcao = fields.funcao;
  if (fields.accountSuspended !== undefined) patch.account_suspended = fields.accountSuspended;
  const { error } = await sb.from("tenant_members").update(patch).eq("id", id);
  if (error) throw new Error(`[team-employees-db] updateProfile: ${error.message}`);
}

export async function updateTeamMemberPasswordInDb(id: string, newPassword: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.rpc("update_member_password", {
    p_id: id,
    p_new_password: newPassword,
  });
  if (error) throw new Error(`[team-employees-db] updatePassword: ${error.message}`);
}

export async function deleteTeamMembersCascadeFromDb(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("tenant_members").delete().in("id", ids);
  if (error) throw new Error(`[team-employees-db] deleteCascade: ${error.message}`);
}

