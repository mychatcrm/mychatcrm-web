import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { isStripeSecretConfigured } from "@/lib/stripe";

/** Rotas financeiras Stripe no admin correspondem aos routeKeys permitidos nas APIs. */
export type AdminFinanceStripeRouteKey = "pagamentos" | "faturas" | "financeiro" | "churn";

export async function enforceAdminFinanceStripe(routeKey: AdminFinanceStripeRouteKey) {
  const session = await getAdminSessionFromCookies();
  if (!session) {
    return { session: null, error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  }
  if (!hasAdminAccess(session, routeKey)) {
    return { session, error: NextResponse.json({ error: "Sem permissão." }, { status: 403 }) };
  }
  if (!isStripeSecretConfigured()) {
    return {
      session,
      error: NextResponse.json(
        { error: "Stripe não configurado: defina STRIPE_SECRET_KEY no ambiente server." },
        { status: 503 },
      ),
    };
  }
  return { session, error: null };
}

export const ADMIN_STRIPE_JSON_HEADERS = { "Cache-Control": "no-store" } as const;
