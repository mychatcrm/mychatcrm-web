/**
 * Escopo de acesso a dados de lead — fonte única de verdade do isolamento.
 *
 * Antes desta camada o filtro por dono existia só no cliente
 * (`filterLeadsForSession` num `useMemo`): as rotas devolviam todos os leads do
 * tenant e um vendedor que chamasse a API direto lia e editava lead de colega.
 * Aqui o recorte é aplicado **na query**, antes do dado sair do servidor.
 *
 * Regras (confirmadas com o operador):
 * - Titular da conta: vê tudo.
 * - Diretor: vê os leads das equipes em que está (pode estar em várias).
 * - Gerente: vê os leads da equipe dele (só pode estar em uma).
 * - Vendedor: vê **apenas** os leads atribuídos a ele, mesmo dentro da equipe.
 * - Sem equipe (`team_id is null`, inclui todo o legado): só o titular vê.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import { resolveOrganizationRole } from "@/lib/organization-role";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type AccessScope =
  /** Titular: sem recorte. */
  | { kind: "all" }
  /** Diretor/gerente: leads cujas equipes estão nesta lista. */
  | { kind: "teams"; teamIds: string[] }
  /** Vendedor: apenas os leads atribuídos a ele. */
  | { kind: "own"; employeeId: string };

/** Escopo que não casa com nada — usado quando o papel não resolve um recorte seguro. */
export const EMPTY_TEAM_SCOPE: AccessScope = { kind: "teams", teamIds: [] };

export async function resolveAccessScope(
  sb: SupabaseServiceClient,
  session: ClientSession,
): Promise<AccessScope> {
  const role = resolveOrganizationRole(session);
  if (role === "owner") return { kind: "all" };

  // Sessão sem colaborador vinculado não consegue provar a que equipe pertence.
  // Fail-closed: nada é devolvido (antes, `crmOwnerIdScopeForSession` devolvia
  // `null` aqui, o que significava "vê tudo").
  if (!session.employeeId) return EMPTY_TEAM_SCOPE;

  if (role === "seller") return { kind: "own", employeeId: session.employeeId };

  const { data, error } = await sb
    .from("team_members")
    .select("team_id")
    .eq("tenant_id", session.tenantId)
    .eq("employee_id", session.employeeId);

  if (error) {
    console.error("[access-scope] team_members query failed", error.message);
    return EMPTY_TEAM_SCOPE;
  }

  const teamIds = Array.from(
    new Set((data ?? []).map((row) => String((row as { team_id: string }).team_id))),
  );
  return { kind: "teams", teamIds };
}

/** `true` quando o escopo não pode casar com nenhuma linha — evita ida ao banco. */
export function scopeMatchesNothing(scope: AccessScope): boolean {
  return scope.kind === "teams" && scope.teamIds.length === 0;
}

/** Forma mínima de lead necessária para decidir visibilidade. */
export type ScopableLead = {
  team_id?: string | null;
  owner_employee_id?: string | null;
};

/**
 * Mesma decisão de `applyLeadScope`, para quando o lead já está em memória
 * (rotas de recurso único, ações em lote, join de conversa/agenda).
 */
export function leadInScope(lead: ScopableLead, scope: AccessScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "own") {
    return Boolean(lead.owner_employee_id) && lead.owner_employee_id === scope.employeeId;
  }
  // Legado sem equipe nunca aparece para diretor/gerente — só para o titular.
  if (!lead.team_id) return false;
  return scope.teamIds.includes(lead.team_id);
}

/**
 * Carrega o lead já validado contra o escopo. Devolve `null` tanto quando o
 * lead não existe quanto quando está fora do escopo — o chamador responde 404
 * nos dois casos, para não revelar que o registo existe.
 *
 * Para o titular não há recorte a verificar, então nem consulta: a query que o
 * próprio handler faz em seguida é quem decide se o lead existe.
 */
export async function loadLeadInScope(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadId: string,
  scope: AccessScope,
): Promise<ScopableLead | null> {
  if (scope.kind === "all") return {};
  if (scopeMatchesNothing(scope)) return null;

  const { data, error } = await sb
    .from("leads")
    .select("id, team_id, owner_employee_id")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) return null;
  const lead = data as ScopableLead;
  return leadInScope(lead, scope) ? lead : null;
}

/**
 * Ids dos leads visíveis no escopo — base para recortar conversas e agenda,
 * que se ligam ao lead por `lead_id`.
 */
export async function visibleLeadIds(
  sb: SupabaseServiceClient,
  tenantId: string,
  scope: AccessScope,
): Promise<Set<string> | null> {
  // `null` = sem recorte (titular): o chamador não precisa filtrar.
  if (scope.kind === "all") return null;
  if (scopeMatchesNothing(scope)) return new Set();

  const base = sb.from("leads").select("id").eq("tenant_id", tenantId);
  const { data, error } =
    scope.kind === "own"
      ? await base.eq("owner_employee_id", scope.employeeId)
      : await base.in("team_id", scope.teamIds);
  if (error) {
    console.error("[access-scope] visibleLeadIds query failed", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => String((row as { id: string }).id)));
}
