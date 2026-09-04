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
  const search = url.searchParams.get("q")?.trim() ?? "";
  const filterStatus = url.searchParams.get("status") ?? "all";
  const filterPlan = url.searchParams.get("plan") ?? "all";

  const sb = createSupabaseServiceClient();

  const { data, error } = await sb.rpc("get_admin_clients_v1", {
    p_search: search || null,
    p_status: filterStatus === "all" ? null : filterStatus,
    p_plan: filterPlan === "all" ? null : filterPlan,
    p_limit: 500,
  });

  if (error) {
    console.error("[admin/clients] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar clientes." }, { status: 500 });
  }

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const rows = Array.isArray(payload.clients) ? payload.clients : [];
  const total = typeof payload.total === "number" ? payload.total : rows.length;

  return NextResponse.json(
    { clients: rows, total },
    { headers: { "Cache-Control": "no-store" } },
  );
}
