import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "clientes")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const filterStatus = url.searchParams.get("status") ?? "all";
  const filterPlan = url.searchParams.get("plan") ?? "all";

  const sb = createSupabaseServiceClient();

  let query = sb
    .from("tenants")
    .select(
      "id,name,email,plan_slug,status,created_at,stripe_customer_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (filterStatus !== "all") {
    query = query.eq("status", filterStatus);
  }
  if (filterPlan !== "all") {
    query = query.eq("plan_slug", filterPlan);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[admin/clients] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar clientes." }, { status: 500 });
  }

  let rows = (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name ?? "") as string,
    email: (row.email ?? "") as string,
    planSlug: (row.plan_slug ?? "") as string,
    status: (row.status ?? "active") as string,
    createdAt: row.created_at as string,
    stripeCustomerId: (row.stripe_customer_id ?? null) as string | null,
  }));

  if (search) {
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(search) ||
        r.email.toLowerCase().includes(search) ||
        r.planSlug.toLowerCase().includes(search),
    );
  }

  return NextResponse.json(
    { clients: rows, total: count ?? rows.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
