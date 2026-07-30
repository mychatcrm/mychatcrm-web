/**
 * Acesso a equipes via Supabase (service_role — código de servidor apenas).
 *
 * A tabela `team_members` guarda o vínculo colaborador↔equipe. O papel exercido
 * (`role_in_team`) é copiado de `tenant_members.hierarchy_role` no momento do
 * vínculo, para o índice parcial do banco conseguir garantir "gerente e vendedor
 * em no máximo uma equipe" sem precisar de subquery.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Team, TeamMemberLink } from "@/lib/teams-types";
import type { TeamHierarchyRole } from "@/lib/team-employees-types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type DbTeam = {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: string;
};

type DbTeamMember = {
  team_id: string;
  employee_id: string;
  role_in_team: TeamHierarchyRole;
};

/** Código do Postgres para violação de unique — usado para virar mensagem útil. */
const UNIQUE_VIOLATION = "23505";

export function isSingleTeamViolation(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === UNIQUE_VIOLATION &&
    (error.message ?? "").includes("team_members_one_team_for_manager_seller")
  );
}

export async function listTeams(tenantId: string): Promise<Team[]> {
  const sb = createSupabaseServiceClient();
  const [{ data: teamRows, error: teamsError }, { data: memberRows, error: membersError }] =
    await Promise.all([
      sb.from("teams").select("id, tenant_id, name, active, created_at").eq("tenant_id", tenantId),
      sb.from("team_members").select("team_id, employee_id, role_in_team").eq("tenant_id", tenantId),
    ]);

  if (teamsError) throw new Error(`[teams-db] listTeams: ${teamsError.message}`);
  if (membersError) throw new Error(`[teams-db] listTeamMembers: ${membersError.message}`);

  const linksByTeam = new Map<string, TeamMemberLink[]>();
  for (const row of (memberRows ?? []) as DbTeamMember[]) {
    const list = linksByTeam.get(row.team_id) ?? [];
    list.push({ employeeId: row.employee_id, roleInTeam: row.role_in_team });
    linksByTeam.set(row.team_id, list);
  }

  return ((teamRows ?? []) as DbTeam[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      members: linksByTeam.get(row.id) ?? [],
      createdAt: row.created_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function replaceTeamMembers(
  sb: SupabaseServiceClient,
  tenantId: string,
  teamId: string,
  members: TeamMemberLink[],
): Promise<void> {
  const { error: deleteError } = await sb
    .from("team_members")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("team_id", teamId);
  if (deleteError) throw new Error(`[teams-db] clearMembers: ${deleteError.message}`);

  if (members.length === 0) return;

  const { error: insertError } = await sb.from("team_members").insert(
    members.map((m) => ({
      tenant_id: tenantId,
      team_id: teamId,
      employee_id: m.employeeId,
      role_in_team: m.roleInTeam,
    })),
  );
  if (insertError) {
    if (isSingleTeamViolation(insertError)) {
      throw new Error("SINGLE_TEAM_VIOLATION");
    }
    throw new Error(`[teams-db] insertMembers: ${insertError.message}`);
  }
}

export async function createTeam(
  tenantId: string,
  input: { name: string; active: boolean; members: TeamMemberLink[] },
): Promise<Team> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("teams")
    .insert({ tenant_id: tenantId, name: input.name, active: input.active })
    .select("id, tenant_id, name, active, created_at")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error("DUPLICATE_TEAM_NAME");
    throw new Error(`[teams-db] createTeam: ${error.message}`);
  }

  const row = data as DbTeam;
  try {
    await replaceTeamMembers(sb, tenantId, row.id, input.members);
  } catch (err) {
    // Sem transação no PostgREST: se o vínculo falhar, remove a equipe recém
    // criada para não deixar equipe órfã e vazia no painel.
    await sb.from("teams").delete().eq("id", row.id).eq("tenant_id", tenantId);
    throw err;
  }

  return {
    id: row.id,
    name: row.name,
    active: row.active,
    members: input.members,
    createdAt: row.created_at,
  };
}

export async function updateTeam(
  tenantId: string,
  teamId: string,
  input: { name?: string; active?: boolean; members?: TeamMemberLink[] },
): Promise<void> {
  const sb = createSupabaseServiceClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.active !== undefined) patch.active = input.active;

  const { error } = await sb.from("teams").update(patch).eq("id", teamId).eq("tenant_id", tenantId);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new Error("DUPLICATE_TEAM_NAME");
    throw new Error(`[teams-db] updateTeam: ${error.message}`);
  }

  if (input.members) {
    await replaceTeamMembers(sb, tenantId, teamId, input.members);
  }
}

/**
 * Apagar a equipe não apaga lead nem conversa: as FKs são `on delete set null`,
 * então os dados voltam para "sem equipe" (visível só para o titular).
 */
export async function deleteTeam(tenantId: string, teamId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("teams").delete().eq("id", teamId).eq("tenant_id", tenantId);
  if (error) throw new Error(`[teams-db] deleteTeam: ${error.message}`);
}
