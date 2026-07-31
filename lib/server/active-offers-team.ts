/**
 * Equipe dona de uma lista de ligação.
 *
 * A lista não tinha equipe: qualquer diretor ou gerente enxergava as listas de
 * toda a conta, inclusive de outra equipe — e ao abrir, os leads vinham junto.
 * Isto fecha a mesma fronteira que já vale para lead, conversa e agenda.
 *
 * A equipe é **derivada dos leads** que entraram na lista, não escolhida à mão:
 * quem monta a lista já está limitado ao próprio escopo (`restrictLeadIdsToScope`),
 * então os leads são a fonte honesta. Lista com leads de equipes diferentes —
 * possível só para o titular — fica sem equipe e visível apenas a ele.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AccessScope } from "@/lib/server/access-scope";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/** `null` quando os leads não têm equipe, ou têm mais de uma. */
export async function deriveOfferTeamId(
  sb: ReturnType<typeof createSupabaseServiceClient> | SupabaseLike,
  tenantId: string,
  leadIds: string[],
): Promise<string | null> {
  if (leadIds.length === 0) return null;

  const { data, error } = await (sb as SupabaseLike)
    .from("leads")
    .select("team_id")
    .eq("tenant_id", tenantId)
    .in("id", leadIds);

  if (error || !Array.isArray(data)) return null;

  const teams = new Set<string>();
  for (const row of data as Array<{ team_id?: unknown }>) {
    if (typeof row.team_id === "string" && row.team_id.trim()) teams.add(row.team_id);
    else return null; // lead sem equipe torna a lista inteira sem equipe
  }
  return teams.size === 1 ? Array.from(teams)[0]! : null;
}

/** Forma mínima da lista para decidir visibilidade. */
export type ScopableOffer = {
  team_id?: string | null;
  created_by?: string | null;
};

/**
 * Diretor/gerente veem as listas das equipes deles. Lista sem equipe fica com
 * o titular — e com quem a criou, para uma lista antiga (anterior a esta
 * mudança) não sumir do painel de quem a montou.
 */
export function offerInTeamScope(
  offer: ScopableOffer,
  scope: AccessScope,
  actorEmail?: string | null,
): boolean {
  if (scope.kind === "all") return true;
  if (!offer.team_id) {
    return Boolean(actorEmail && offer.created_by && offer.created_by === actorEmail);
  }
  if (scope.kind === "teams") return scope.teamIds.includes(offer.team_id);
  // Vendedor não é recortado por equipe aqui: o filtro dele continua sendo a
  // lista de designados (`offerVisibleToEmployee`), aplicada pelo chamador.
  return true;
}
