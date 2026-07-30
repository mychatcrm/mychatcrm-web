/**
 * GET /api/client/stats/team-overview?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Retorna métricas de desempenho por colaborador ativo do tenant.
 * Retorna [] se o tenant não tiver membros cadastrados.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveAccessScope } from "@/lib/server/access-scope";
import type { TeamMemberStats } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

type MemberRow = { id: string; nome: string; funcao: string; hierarchy_role: string };

/**
 * Colaboradores que o autor da consulta pode ver no relatório:
 * titular vê todos; diretor/gerente veem quem está nas equipes deles;
 * vendedor vê apenas a si mesmo.
 */
async function restrictMembersToScope(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  session: NonNullable<Awaited<ReturnType<typeof getClientSessionFromCookies>>>,
  members: MemberRow[],
): Promise<MemberRow[]> {
  const scope = await resolveAccessScope(sb, session);
  if (scope.kind === "all") return members;
  if (scope.kind === "own") return members.filter((m) => m.id === scope.employeeId);
  if (scope.teamIds.length === 0) return [];

  const { data, error } = await sb
    .from("team_members")
    .select("employee_id")
    .eq("tenant_id", session.tenantId)
    .in("team_id", scope.teamIds);

  if (error) {
    console.error("[team-overview] team scope query failed", error.message);
    return [];
  }
  const allowed = new Set((data ?? []).map((row) => String((row as { employee_id: string }).employee_id)));
  return members.filter((m) => allowed.has(m.id));
}

export async function GET(req: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 6);

  const fromISO = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : formatDateISO(defaultFrom);
  const toISO = rawTo && ISO_DATE.test(rawTo) ? rawTo : formatDateISO(today);
  const fromTs = `${fromISO}T00:00:00.000Z`;
  const toTs = `${toISO}T23:59:59.999Z`;

  try {
    const sb = createSupabaseServiceClient();

    const { data: allMembers, error: membersError } = await sb
      .from("tenant_members")
      .select("id, nome, funcao, hierarchy_role")
      .eq("tenant_id", session.tenantId)
      .eq("ativo", true)
      .order("nome", { ascending: true });

    if (membersError) throw membersError;
    if (!allMembers || allMembers.length === 0) {
      return NextResponse.json([]);
    }

    // Antes desta linha, qualquer gerente via o desempenho da empresa inteira,
    // inclusive de equipes que não são dele. O recorte usa as mesmas equipes
    // que definem a visibilidade de leads.
    const members = await restrictMembersToScope(sb, session, allMembers);
    if (members.length === 0) return NextResponse.json([]);

    const memberIds = members.map((m) => m.id as string);

    const [leadsRes, activeConvsRes, closedConvsRes] = await Promise.all([
      sb.from("leads")
        .select("owner_employee_id")
        .eq("tenant_id", session.tenantId)
        .in("owner_employee_id", memberIds)
        .gte("created_at", fromTs)
        .lte("created_at", toTs),

      sb.from("conversation_states")
        .select("assigned_human_id")
        .eq("tenant_id", session.tenantId)
        .in("assigned_human_id", memberIds)
        .is("archived_at", null),

      sb.from("conversation_states")
        .select("assigned_human_id")
        .eq("tenant_id", session.tenantId)
        .in("assigned_human_id", memberIds)
        .gte("archived_at", fromTs)
        .lte("archived_at", toTs),
    ]);

    const leadCounts: Record<string, number> = {};
    const activeConvCounts: Record<string, number> = {};
    const closedConvCounts: Record<string, number> = {};

    for (const row of leadsRes.data ?? []) {
      const id = row.owner_employee_id as string;
      leadCounts[id] = (leadCounts[id] ?? 0) + 1;
    }
    for (const row of activeConvsRes.data ?? []) {
      const id = row.assigned_human_id as string;
      activeConvCounts[id] = (activeConvCounts[id] ?? 0) + 1;
    }
    for (const row of closedConvsRes.data ?? []) {
      const id = row.assigned_human_id as string;
      closedConvCounts[id] = (closedConvCounts[id] ?? 0) + 1;
    }

    const result: TeamMemberStats[] = members.map((m) => ({
      id: m.id as string,
      nome: m.nome as string,
      funcao: (m.funcao as string | null) ?? "",
      hierarchyRole: (m.hierarchy_role as string | null) ?? "seller",
      leadsCount: leadCounts[m.id as string] ?? 0,
      activeConvs: activeConvCounts[m.id as string] ?? 0,
      closedConvs: closedConvCounts[m.id as string] ?? 0,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[stats/team-overview] query failed:", err);
    return NextResponse.json({ error: "Erro ao carregar equipe" }, { status: 500 });
  }
}
