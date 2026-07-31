import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type MetaConnectionStatus = {
  connected: boolean;
  actionRequired: boolean;
  verificationPending: boolean;
  grantDiscoveryStatus: string | null;
  pages: Array<{ pageName: string | null; healthStatus: string }>;
};

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const sb = createSupabaseServiceClient();

    const [connectionsResult, grantResult] = await Promise.all([
      sb
        .from("meta_connections")
        .select("page_name, health_status")
        .eq("tenant_id", session.tenantId)
        .order("connected_at", { ascending: true }),
      sb
        .from("meta_lead_grants")
        .select("discovery_status")
        .eq("tenant_id", session.tenantId)
        .maybeSingle<{ discovery_status: string }>(),
    ]);
    const { data, error } = connectionsResult;
    const { data: grant, error: grantError } = grantResult;

    if (error) throw error;
    if (grantError) throw grantError;

    const pages = (data ?? []).map((row) => ({
      pageName: (row.page_name as string | null) ?? null,
      healthStatus: (row.health_status as string | null) ?? "unverified",
    }));

    const grantPending =
      grant?.discovery_status === "pending" ||
      grant?.discovery_status === "discovering" ||
      grant?.discovery_status === "retrying";
    const grantActionRequired =
      grant?.discovery_status === "action_required";
    const result: MetaConnectionStatus = {
      connected: !grantPending && !grantActionRequired && pages.some(
        (page) =>
          page.healthStatus === "ready" ||
          page.healthStatus === "degraded" ||
          page.healthStatus === "legacy_grace",
      ),
      actionRequired: grantActionRequired || pages.some(
        (page) =>
          page.healthStatus === "action_required" ||
          page.healthStatus === "revoked",
      ),
      verificationPending: grantPending,
      grantDiscoveryStatus: grant?.discovery_status ?? null,
      pages,
    };

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[meta/connection-status] query failed:", err);
    return NextResponse.json({ error: "Erro ao verificar conexão Meta" }, { status: 500 });
  }
}
