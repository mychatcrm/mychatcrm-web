/**
 * Escopo de acesso a reunioes — fronteira de isolamento do modulo.
 *
 * Compoe com `lib/server/access-scope.ts` em vez de criar hierarquia paralela:
 * o recorte por dono/equipe/funil continua vindo de `resolveAccessScope`, e
 * aqui so entra a camada de visibilidade que e propria da reuniao.
 *
 * Regras (§20 do plano):
 * - Titular da conta (`scope.kind === "all"`): ve tudo.
 * - Autor: sempre ve a propria reuniao, qualquer que seja a visibilidade.
 * - `company`: todo mundo do tenant.
 * - `team`: quem tem a equipe da reuniao no proprio escopo (diretor/gerente).
 * - `lead`: quem ja alcanca o lead vinculado — reusa `leadInScope`, entao a
 *   restricao por funil e por dono vale igual, sem duplicar regra.
 * - `private`: so o autor e o titular.
 * - Compartilhamento pontual (`meeting_access_grants`) libera caso a caso.
 *
 * Fora do escopo, o chamador responde **404** (nunca 403): confirmar que o
 * registro existe ja e vazamento de informacao entre empresas.
 */
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ClientSession } from "@/lib/client-auth";
import {
  leadInScope,
  visibleLeadIds,
  SCOPABLE_LEAD_COLUMNS,
  type AccessScope,
  type ScopableLead,
} from "@/lib/server/access-scope";
import {
  SCOPABLE_MEETING_COLUMNS,
  type ScopableMeeting,
} from "@/lib/meetings/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Identificador de colaborador utilizavel — string nao vazia. */
function employeeIdOf(session: Pick<ClientSession, "employeeId">): string | null {
  const id = session.employeeId?.trim();
  return id ? id : null;
}

/**
 * O autor sempre alcanca a propria reuniao.
 *
 * A comparacao exige os dois lados preenchidos de proposito: reuniao criada
 * pelo titular grava `created_by_employee_id = null`, e sessao de titular nao
 * tem `employeeId`. Sem esta guarda, `null == undefined` faria toda reuniao do
 * titular parecer "de autoria" de qualquer sessao sem colaborador.
 */
function isAuthor(
  meeting: ScopableMeeting,
  session: Pick<ClientSession, "employeeId">,
): boolean {
  const employeeId = employeeIdOf(session);
  const author = meeting.created_by_employee_id?.trim();
  return Boolean(employeeId && author && author === employeeId);
}

/**
 * Decisao sincrona de visibilidade.
 *
 * `lead` e obrigatorio quando a reuniao e `visibility: "lead"` — sem a linha do
 * lead nao da para decidir, e chutar seria falhar aberto. Nesse caso, ausencia
 * de lead devolve `false`.
 */
export function meetingInScope(
  meeting: ScopableMeeting,
  scope: AccessScope,
  session: Pick<ClientSession, "employeeId">,
  lead?: ScopableLead | null,
): boolean {
  // Titular: sem recorte.
  if (scope.kind === "all") return true;

  // O autor vem ANTES de qualquer outro teste. Um diretor sem equipe nenhuma
  // recebe `{kind:"teams", teamIds: []}` (fail-closed) e, mesmo assim, precisa
  // continuar enxergando o que ele proprio gravou.
  if (isAuthor(meeting, session)) return true;

  const visibility = meeting.visibility ?? "private";

  if (visibility === "company") return true;

  if (visibility === "team") {
    const teamId = meeting.team_id?.trim();
    if (!teamId) return false;
    // Vendedor (`kind: "own"`) nao herda reuniao de equipe: o recorte dele e
    // por atribuicao, igual ao que ja vale para lead e conversa.
    return scope.kind === "teams" && scope.teamIds.includes(teamId);
  }

  if (visibility === "lead") {
    if (!meeting.lead_id?.trim() || !lead) return false;
    return leadInScope(lead, scope);
  }

  // `private`: so autor e titular, ambos ja tratados acima.
  return false;
}

/**
 * Compartilhamento pontual: libera uma reuniao especifica para um colaborador
 * que o escopo normal nao alcancaria.
 */
export async function hasMeetingAccessGrant(
  sb: SupabaseServiceClient,
  tenantId: string,
  meetingId: string,
  session: Pick<ClientSession, "employeeId">,
): Promise<boolean> {
  const employeeId = employeeIdOf(session);
  if (!employeeId) return false;

  const { data, error } = await sb
    .from("meeting_access_grants")
    .select("meeting_id")
    .eq("tenant_id", tenantId)
    .eq("meeting_id", meetingId)
    .eq("employee_id", employeeId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("[meeting-access-scope] grant query failed", error.message);
    return false;
  }
  return Boolean(data);
}

/**
 * Carrega a reuniao ja validada contra o escopo.
 *
 * Devolve `null` tanto quando a reuniao nao existe quanto quando esta fora do
 * escopo — o chamador responde 404 nos dois casos, pela mesma razao que
 * `loadLeadInScope` faz isso.
 */
export async function loadMeetingInScope<T extends Record<string, unknown>>(
  sb: SupabaseServiceClient,
  tenantId: string,
  meetingId: string,
  scope: AccessScope,
  session: Pick<ClientSession, "employeeId">,
  columns = "*",
): Promise<T | null> {
  const select = columns === "*" ? "*" : `${columns}, ${SCOPABLE_MEETING_COLUMNS}`;

  const { data, error } = await sb
    .from("meetings")
    .select(select)
    .eq("tenant_id", tenantId)
    .eq("id", meetingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  const meeting = data as unknown as ScopableMeeting;

  // Reuniao de lead precisa da linha do lead para decidir. Carregada so quando
  // realmente pesa na decisao — titular e autor nunca chegam aqui.
  let lead: ScopableLead | null = null;
  const needsLead =
    scope.kind !== "all" &&
    !isAuthor(meeting, session) &&
    (meeting.visibility ?? "private") === "lead" &&
    Boolean(meeting.lead_id);

  if (needsLead) {
    const { data: leadRow } = await sb
      .from("leads")
      .select(SCOPABLE_LEAD_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", meeting.lead_id as string)
      .maybeSingle();
    lead = (leadRow as ScopableLead | null) ?? null;
  }

  if (meetingInScope(meeting, scope, session, lead)) {
    return data as unknown as T;
  }

  // Ultimo recurso: compartilhamento explicito daquela reuniao.
  if (await hasMeetingAccessGrant(sb, tenantId, meetingId, session)) {
    return data as unknown as T;
  }

  return null;
}

/**
 * Filtro de listagem.
 *
 * Recortar em memoria depois de ler tudo seria o mesmo erro que
 * `access-scope.ts` foi criado para corrigir: o recorte tem que estar **na
 * query**, antes de o dado sair do servidor.
 */
export type MeetingVisibilityFilter =
  /** Titular: sem recorte. */
  | { kind: "all" }
  /** Expressao pronta para `.or(...)` do PostgREST. */
  | { kind: "or"; expression: string }
  /** Nenhuma condicao pode casar — evita ida ao banco. */
  | { kind: "none" };

/** Ids seguros para interpolar numa lista `in.(...)` do PostgREST. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Teto de leads considerados na condicao de visibilidade por lead.
 *
 * Mesma abordagem ja usada em `filterConversationsInScope`. Acima do teto a
 * condicao de lead e omitida e a reuniao so aparece pelas outras vias — nunca
 * amplia o que o colaborador ve, apenas deixa de listar por essa rota. Se um
 * tenant chegar perto disso, o caminho certo passa a ser carimbar o recorte na
 * propria linha da reuniao.
 */
const MAX_LEAD_IDS_IN_FILTER = 500;

export async function buildMeetingVisibilityFilter(
  sb: SupabaseServiceClient,
  tenantId: string,
  scope: AccessScope,
  session: Pick<ClientSession, "employeeId">,
): Promise<MeetingVisibilityFilter> {
  if (scope.kind === "all") return { kind: "all" };

  const conditions: string[] = ["visibility.eq.company"];

  const employeeId = employeeIdOf(session);
  if (employeeId && SAFE_ID.test(employeeId)) {
    conditions.push(`created_by_employee_id.eq.${employeeId}`);
  }

  if (scope.kind === "teams") {
    const teamIds = scope.teamIds.filter((id) => SAFE_ID.test(id));
    if (teamIds.length > 0) {
      conditions.push(`and(visibility.eq.team,team_id.in.(${teamIds.join(",")}))`);
    }
  }

  const leadIds = await visibleLeadIds(sb, tenantId, scope);
  if (leadIds && leadIds.size > 0 && leadIds.size <= MAX_LEAD_IDS_IN_FILTER) {
    const ids = Array.from(leadIds).filter((id) => SAFE_ID.test(id));
    if (ids.length > 0) {
      conditions.push(`and(visibility.eq.lead,lead_id.in.(${ids.join(",")}))`);
    }
  }

  // `visibility.eq.company` esta sempre presente, entao nunca cai em "none";
  // o ramo existe para o caso de a lista de condicoes ficar vazia numa evolucao
  // futura, e para o chamador nao precisar tratar string vazia.
  if (conditions.length === 0) return { kind: "none" };

  return { kind: "or", expression: conditions.join(",") };
}
