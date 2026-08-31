import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "leads-lancamento")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const sb = createSupabaseServiceClient();
  let query = sb
    .from("pre_launch_leads")
    .select("id,full_name,whatsapp,email,business_description,ddd,source,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error, count } = await query;
  if (error) {
    console.error("[admin/pre-launch-leads] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar leads." }, { status: 500 });
  }

  return NextResponse.json(
    {
      leads: (data ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        whatsapp: row.whatsapp,
        email: row.email,
        businessDescription: row.business_description,
        ddd: row.ddd,
        source: row.source,
        createdAt: row.created_at,
      })),
      total: count ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
