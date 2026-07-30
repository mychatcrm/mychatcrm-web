import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  executeCrmLeadBulkAction,
  type CrmBulkAction,
} from "@/lib/server/crm-leads-bulk-actions";
import { readTeamMembersFromDb } from "@/lib/server/team-employees-db";
import { resolveAccessScope } from "@/lib/server/access-scope";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set<CrmBulkAction>([
  "assign_attendant",
  "change_status",
  "convert_to_active_offer",
  "delete",
]);

function parseAction(value: unknown): CrmBulkAction | null {
  if (typeof value !== "string") return null;
  return VALID_ACTIONS.has(value as CrmBulkAction) ? (value as CrmBulkAction) : null;
}

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const action = parseAction(body.action);
  if (!action) return NextResponse.json({ error: "Ação em lote inválida." }, { status: 400 });

  const sb = createSupabaseServiceClient();
  try {
    const teamEmployees =
      action === "assign_attendant"
        ? await readTeamMembersFromDb(session.tenantId, session.email)
        : undefined;
    const result = await executeCrmLeadBulkAction({
      sb,
      tenantId: session.tenantId,
      actorEmail: session.email,
      action,
      leadIds: body.leadIds,
      payload: typeof body.payload === "object" && body.payload !== null ? (body.payload as Record<string, unknown>) : {},
      teamEmployees,
      scope: await resolveAccessScope(sb, session),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao executar ação em lote.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
