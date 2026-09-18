import "server-only";

import { NextResponse } from "next/server";
import type { ClientSession } from "@/lib/client-auth";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveOrganizationRole } from "@/lib/organization-role";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type LandingGuardOk = {
  ok: true;
  session: ClientSession;
  sb: SupabaseServiceClient;
  /** Só o titular compra crédito, compra domínio e publica. */
  canManage: boolean;
};

/**
 * Porta única das rotas de páginas.
 *
 * Repete a lição da Central: o middleware valida papel em `/dashboard/*` e
 * **nunca** em `/api/*`. Sem esta checagem, um vendedor autenticado chamaria
 * `/api/client/landing-pages` e publicaria, arquivaria ou gastaria o crédito da
 * empresa — mesmo sem o item aparecer no menu dele.
 *
 * Aqui a régua é mais apertada que a da Central de propósito: página e domínio
 * são a cara pública do negócio, e crédito é dinheiro. Isso é do titular.
 */
export async function requireLandingAccess(options: { manageOnly?: boolean } = {}): Promise<
  LandingGuardOk | { ok: false; response: NextResponse }
> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard;
  const { session } = guard;

  const role = resolveOrganizationRole(session);
  const canManage = role === "owner";

  if (!canManage && role !== "director") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sem permissão para as Páginas de Captura.", code: "FORBIDDEN_ROUTE" },
        { status: 403 },
      ),
    };
  }

  if (options.manageOnly && !canManage) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Apenas o titular da conta pode fazer isto.", code: "OWNER_ONLY" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session, sb: createSupabaseServiceClient(), canManage };
}

/** Rótulo curto de quem agiu — vai para o extrato de créditos e para o arquivo. */
export function landingActorLabel(session: ClientSession): string {
  return session.employeeId?.trim() || "owner";
}
