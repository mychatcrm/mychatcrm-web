import "server-only";

import { NextResponse } from "next/server";
import type { ClientSession } from "@/lib/client-auth";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveAccessScope, type AccessScope } from "@/lib/server/access-scope";
import { resolveOrganizationRole, sessionCanAccessDashboardRoute } from "@/lib/organization-role";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type CentralGuardOk = {
  ok: true;
  session: ClientSession;
  sb: SupabaseServiceClient;
  scope: AccessScope;
  /** Só o titular vê investimento, CPL e custo por resultado. */
  canSeeSpend: boolean;
};

/**
 * Porta única das rotas da Central.
 *
 * O middleware só valida papel em `/dashboard/*` — nunca em `/api/*`. Sem esta
 * checagem, um vendedor autenticado pedia `/api/client/meta/lead-events` e
 * recebia nome, telefone e e-mail de **todos** os leads do tenant, embora a
 * página nem apareça no menu dele. O recorte por equipe/dono vem junto, já
 * resolvido, para nenhuma rota esquecer de aplicar.
 */
export async function requireCentralAccess(): Promise<
  CentralGuardOk | { ok: false; response: NextResponse }
> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard;
  const { session } = guard;

  if (!sessionCanAccessDashboardRoute(session, "integracoes-leads")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sem permissão para a Central de Leads.", code: "FORBIDDEN_ROUTE" },
        { status: 403 },
      ),
    };
  }

  const sb = createSupabaseServiceClient();
  const scope = await resolveAccessScope(sb, session);
  return {
    ok: true,
    session,
    sb,
    scope,
    canSeeSpend: resolveOrganizationRole(session) === "owner",
  };
}

/** Rótulo curto de quem agiu — vai para `archived_by` e para a auditoria. */
export function actorLabel(session: ClientSession): string {
  return session.employeeId?.trim() || "owner";
}
