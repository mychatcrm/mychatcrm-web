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
  /**
   * Diretor/gerente: leads cujas equipes estão nesta lista.
   * `funnelIds` (opcional) restringe adicionalmente aos funis liberados.
   */
  | { kind: "teams"; teamIds: string[]; funnelIds?: string[] }
  /**
   * Vendedor: apenas os leads atribuídos a ele.
   * `funnelIds` (opcional) restringe adicionalmente aos funis liberados.
   */
  | { kind: "own"; employeeId: string; funnelIds?: string[] };

/** Escopo que não casa com nada — usado quando o papel não resolve um recorte seguro. */
export const EMPTY_TEAM_SCOPE: AccessScope = { kind: "teams", teamIds: [] };

/**
 * Funis liberados para o colaborador.
 *
 * `null` = sem restrição por funil (nenhuma liberação configurada). É o padrão
 * e mantém o comportamento anterior — liberar funis é opt-in, senão o deploy
 * esconderia os leads de todo mundo até o titular configurar.
 */
async function resolveAllowedFunnelIds(
  sb: SupabaseServiceClient,
  tenantId: string,
  employeeId: string,
): Promise<string[] | null> {
  const { data, error } = await sb
    .from("crm_funnel_access")
    .select("funnel_id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId);

  if (error) {
    // Falha de leitura não pode virar liberação geral nem bloqueio total:
    // mantém o recorte por dono/equipe, que é a fronteira principal.
    console.error("[access-scope] crm_funnel_access query failed", error.message);
    return null;
  }

  const funnelIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => String((row as { funnel_id: string }).funnel_id).trim())
        .filter(Boolean),
    ),
  );
  return funnelIds.length ? funnelIds : null;
}

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

  const funnelIds = await resolveAllowedFunnelIds(sb, session.tenantId, session.employeeId);

  if (role === "seller") {
    return { kind: "own", employeeId: session.employeeId, ...(funnelIds ? { funnelIds } : {}) };
  }

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
  return { kind: "teams", teamIds, ...(funnelIds ? { funnelIds } : {}) };
}

/** `true` quando o escopo não pode casar com nenhuma linha — evita ida ao banco. */
export function scopeMatchesNothing(scope: AccessScope): boolean {
  return scope.kind === "teams" && scope.teamIds.length === 0;
}

/** Forma mínima de lead necessária para decidir visibilidade. */
export type ScopableLead = {
  team_id?: string | null;
  owner_employee_id?: string | null;
  crm_funnel_id?: string | null;
};

/** Colunas que `leadInScope` precisa ler — usado em todo select de recorte. */
export const SCOPABLE_LEAD_COLUMNS = "team_id, owner_employee_id, crm_funnel_id";

/**
 * Restrição por funil, quando configurada. Lead sem funil definido não aparece
 * para quem tem liberação explícita — a liberação é uma lista fechada.
 */
function funnelInScope(lead: ScopableLead, funnelIds: string[] | undefined): boolean {
  if (!funnelIds?.length) return true;
  const funnelId = lead.crm_funnel_id?.trim();
  return Boolean(funnelId && funnelIds.includes(funnelId));
}

/**
 * Mesma decisão de `applyLeadScope`, para quando o lead já está em memória
 * (rotas de recurso único, ações em lote, join de conversa/agenda).
 */
export function leadInScope(lead: ScopableLead, scope: AccessScope): boolean {
  if (scope.kind === "all") return true;
  // A liberação por funil só restringe — nunca amplia o recorte por dono/equipe.
  if (!funnelInScope(lead, scope.funnelIds)) return false;
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
    .select(`id, ${SCOPABLE_LEAD_COLUMNS}`)
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) return null;
  const lead = data as ScopableLead;
  return leadInScope(lead, scope) ? lead : null;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * A conversa é alcançável por quem alcança o lead por trás dela.
 *
 * Recortar só a listagem não bastava: as rotas de mensagem, envio, takeover e
 * pausa recebem o `remoteJid` direto do cliente, então sem esta checagem um
 * vendedor leria e responderia a conversa de um colega apenas sabendo o número.
 *
 * Conversa sem lead identificado fica restrita ao titular — mesma regra do
 * legado sem equipe.
 */
export async function conversationInScope(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
  scope: AccessScope,
): Promise<boolean> {
  if (scope.kind === "all") return true;
  if (scopeMatchesNothing(scope)) return false;

  const { data: state } = await sb
    .from("conversation_states")
    .select("lead_id")
    .eq("tenant_id", tenantId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  const leadId = typeof (state as { lead_id?: unknown } | null)?.lead_id === "string"
    ? String((state as { lead_id: string }).lead_id)
    : null;

  if (leadId) {
    return Boolean(await loadLeadInScope(sb, tenantId, leadId, scope));
  }

  // Sem `lead_id` na conversa, tenta casar pelo telefone — é assim que a
  // listagem resolve o lead de conversas antigas.
  const phone = digitsOnly(remoteJid.split("@")[0] ?? remoteJid);
  if (phone.length < 10) return false;

  const { data: lead } = await sb
    .from("leads")
    .select(SCOPABLE_LEAD_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .maybeSingle();

  if (!lead) return false;
  return leadInScope(lead as ScopableLead, scope);
}

/**
 * Versão em lote de `conversationInScope`, em 3 consultas em vez de uma por
 * conversa — a rota de arquivar aceita até 500 de uma vez.
 */
export async function filterConversationsInScope(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJids: string[],
  scope: AccessScope,
): Promise<string[]> {
  if (scope.kind === "all") return remoteJids;
  if (scopeMatchesNothing(scope) || remoteJids.length === 0) return [];

  const allowedLeads = await visibleLeadIds(sb, tenantId, scope);
  if (allowedLeads === null) return remoteJids;
  if (allowedLeads.size === 0) return [];

  const { data: states } = await sb
    .from("conversation_states")
    .select("remote_jid, lead_id")
    .eq("tenant_id", tenantId)
    .in("remote_jid", remoteJids);

  const leadByJid = new Map<string, string>();
  for (const row of (states ?? []) as Array<{ remote_jid?: unknown; lead_id?: unknown }>) {
    if (typeof row.remote_jid === "string" && typeof row.lead_id === "string") {
      leadByJid.set(row.remote_jid, row.lead_id);
    }
  }

  // Conversas sem `lead_id` ainda podem casar pelo telefone.
  const pending = remoteJids.filter((jid) => !leadByJid.has(jid));
  const phoneToJid = new Map<string, string>();
  for (const jid of pending) {
    const phone = digitsOnly(jid.split("@")[0] ?? jid);
    if (phone.length >= 10) phoneToJid.set(phone, jid);
  }
  if (phoneToJid.size > 0) {
    const { data: leads } = await sb
      .from("leads")
      .select("id, phone")
      .eq("tenant_id", tenantId)
      .in("phone", Array.from(phoneToJid.keys()));
    for (const row of (leads ?? []) as Array<{ id?: unknown; phone?: unknown }>) {
      const phone = typeof row.phone === "string" ? digitsOnly(row.phone) : "";
      const jid = phoneToJid.get(phone);
      if (jid && typeof row.id === "string") leadByJid.set(jid, row.id);
    }
  }

  return remoteJids.filter((jid) => {
    const leadId = leadByJid.get(jid);
    return Boolean(leadId && allowedLeads.has(leadId));
  });
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

  let base = sb.from("leads").select("id").eq("tenant_id", tenantId);
  // Recorte por funil na própria query, quando o colaborador tem liberação.
  if (scope.funnelIds?.length) base = base.in("crm_funnel_id", scope.funnelIds);

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
