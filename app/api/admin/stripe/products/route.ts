import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { listStripeProducts } from "@/lib/server/list-stripe-products";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  try {
    const products = await listStripeProducts();
    return NextResponse.json({ products });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao listar produtos no Stripe.";
    console.error("[admin/stripe/products]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
