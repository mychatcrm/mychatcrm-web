import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type MetaStatusPage = {
  page_id: string;
  page_name: string | null;
  connected_at: string;
  forms: MetaStatusForm[];
};

export type MetaStatusForm = {
  form_id: string;
  form_name: string | null;
  agent_id: string | null;
};

export type MetaStatusResponse = {
  connected: boolean;
  pages: MetaStatusPage[];
};

/** Returns Meta connection status and all connected pages with their form-agent mappings. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();

  const { data: connections, error: connectionsError } = await sb
    .from("meta_connections")
    .select("page_id, page_name, connected_at")
    .eq("tenant_id", session.tenantId)
    .order("connected_at", { ascending: true });

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 });
  }

  if (!connections?.length) {
    return NextResponse.json({ connected: false, pages: [] } satisfies MetaStatusResponse);
  }

  const pageIds = connections.map((c) => c.page_id);
  const { data: mappings, error: mappingsError } = await sb
    .from("meta_form_agent_mapping")
    .select("form_id, form_name, agent_id, page_id")
    .eq("tenant_id", session.tenantId)
    .in("page_id", pageIds);

  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 500 });
  }

  const pages: MetaStatusPage[] = connections.map((conn) => ({
    page_id: conn.page_id,
    page_name: conn.page_name,
    connected_at: conn.connected_at,
    forms: (mappings ?? [])
      .filter((m) => m.page_id === conn.page_id)
      .map((m) => ({
        form_id: m.form_id,
        form_name: m.form_name,
        agent_id: m.agent_id,
      })),
  }));

  return NextResponse.json({ connected: pages.length > 0, pages } satisfies MetaStatusResponse);
}
