import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type MetaConnectionStatus = {
  connected: boolean;
  pages: Array<{ pageName: string | null }>;
};

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const sb = createSupabaseServiceClient();

    const { data, error } = await sb
      .from("meta_connections")
      .select("page_name")
      .eq("tenant_id", session.tenantId)
      .order("connected_at", { ascending: true });

    if (error) throw error;

    const pages = (data ?? []).map((row) => ({
      pageName: (row.page_name as string | null) ?? null,
    }));

    const result: MetaConnectionStatus = {
      connected: pages.length > 0,
      pages,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[meta/connection-status] query failed:", err);
    return NextResponse.json({ error: "Erro ao verificar conexão Meta" }, { status: 500 });
  }
}
