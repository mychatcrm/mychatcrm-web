import "server-only";

import { NextResponse } from "next/server";
import type { ClientSession } from "@/lib/client-auth";
import { resolveOrganizationRole, sessionCanAccessDashboardRoute } from "@/lib/organization-role";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";

export type AgentManagementSession = {
  session: ClientSession;
  canManageExternalApis: boolean;
};

/**
 * Guarda única das APIs de `/api/client/agentes`.
 *
 * As rotas usam o cliente `service_role`, portanto a autorização precisa
 * acontecer antes de qualquer consulta. O acesso acompanha exatamente a rota
 * visual `dashboard/agentes`: dono, diretor e gerente; vendedor é negado.
 */
export async function requireAgentManagementSession(): Promise<
  | { ok: true; value: AgentManagementSession }
  | { ok: false; response: NextResponse }
> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard;

  if (!sessionCanAccessDashboardRoute(guard.session, "agentes")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Você não tem permissão para gerenciar agentes.", code: "AGENT_MANAGEMENT_FORBIDDEN" },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    value: {
      session: guard.session,
      canManageExternalApis: resolveOrganizationRole(guard.session) === "owner",
    },
  };
}

