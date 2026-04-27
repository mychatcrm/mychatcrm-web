import { NextResponse } from "next/server";
import { migrateClientSessionFromLegacyCookie, type ClientSession } from "@/lib/client-auth";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";

/**
 * Sessão cliente normalizada + bloqueios de conta (espelha regras críticas do middleware em rotas API).
 */
export async function requireActiveClientSession(): Promise<
  | { ok: true; session: ClientSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }
  const norm = migrateClientSessionFromLegacyCookie(session);
  if (norm.status === "cancelada") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Plano cancelado. Renove em /planos para continuar.", code: "PLAN_CANCELLED" },
        { status: 403 },
      ),
    };
  }
  if (norm.accountSuspended) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Conta suspensa. Contacte o administrador da organização.", code: "ACCOUNT_SUSPENDED" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session: norm };
}
