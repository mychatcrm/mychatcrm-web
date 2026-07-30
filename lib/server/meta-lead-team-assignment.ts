/**
 * Carimbo de equipe e vendedor no lead que entra por uma regra de distribuição.
 *
 * É o elo que faz o isolamento funcionar de ponta a ponta: sem ele o lead nasce
 * sem `team_id` e, pela regra do escopo (lib/server/access-scope.ts), ficaria
 * visível apenas para o titular da conta.
 *
 * No modo `agent_plus_seller` o lead também nasce atribuído a um vendedor, para
 * ele ver a conversa em «Conversas» desde o primeiro contacto e poder pausar o
 * agente e assumir pessoalmente.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type RuleTeamAssignment = {
  teamId: string | null;
  /** Vendedor designado pela regra (só em `agent_plus_seller`). */
  sellerId: string | null;
};

export const EMPTY_RULE_ASSIGNMENT: RuleTeamAssignment = { teamId: null, sellerId: null };

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = value.find((item) => typeof item === "string" && item.trim());
  return typeof first === "string" ? first.trim() : null;
}

/**
 * Lê equipe e vendedor da regra que admitiu o lead. Nunca lança: se a consulta
 * falhar, o lead entra sem carimbo (visível ao titular) em vez de a ingestão
 * inteira quebrar por causa disto.
 */
export async function loadRuleTeamAssignment(
  sb: SupabaseServiceClient,
  tenantId: string,
  ruleId: string | null,
): Promise<RuleTeamAssignment> {
  if (!ruleId) return EMPTY_RULE_ASSIGNMENT;

  const { data, error } = await sb
    .from("lead_distribution_rules")
    .select("team_id, distribution_type, employee_ids")
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn("[meta-lead-team-assignment] rule_lookup_failed", {
        tenant_id: tenantId,
        rule_id: ruleId,
        error: error.message,
      });
    }
    return EMPTY_RULE_ASSIGNMENT;
  }

  const row = data as { team_id?: unknown; distribution_type?: unknown; employee_ids?: unknown };
  const teamId = typeof row.team_id === "string" && row.team_id.trim() ? row.team_id.trim() : null;
  const sellerId =
    row.distribution_type === "agent_plus_seller" ? firstString(row.employee_ids) : null;

  return { teamId, sellerId };
}

/**
 * Campos de equipe/dono a gravar no lead.
 *
 * Lead novo recebe o carimbo da regra. Lead que já existe **não é movido de
 * equipe nem tem o dono trocado** — quem decide isso é a política de conflito
 * configurada na regra, não a chegada de um novo cadastro. Só preenche o que
 * ainda estiver vazio, para o lead antigo deixar de ficar órfão.
 */
export function buildLeadTeamPatch(params: {
  assignment: RuleTeamAssignment;
  isNewLead: boolean;
  currentTeamId?: string | null;
  currentOwnerEmployeeId?: string | null;
}): { team_id?: string; owner_employee_id?: string } {
  const patch: { team_id?: string; owner_employee_id?: string } = {};
  const { assignment, isNewLead } = params;

  if (assignment.teamId && (isNewLead || !params.currentTeamId)) {
    patch.team_id = assignment.teamId;
  }
  if (assignment.sellerId && (isNewLead || !params.currentOwnerEmployeeId)) {
    patch.owner_employee_id = assignment.sellerId;
  }
  return patch;
}
