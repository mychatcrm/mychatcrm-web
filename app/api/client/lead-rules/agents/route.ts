import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TenantAgentRow = {
  agent_id: string;
  display_name: string | null;
  active: boolean | null;
  metadata: Record<string, unknown> | null;
};

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("tenant_agents")
    .select("agent_id, display_name, active, metadata")
    .eq("tenant_id", session.tenantId)
    .eq("active", true)
    .order("display_name")
    .returns<TenantAgentRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agents = (data ?? []).map((agent) => ({
    id: agent.agent_id,
    clientId: session.tenantId,
    nome: agent.display_name?.trim() || agent.agent_id,
    status: agent.active ? "ativo" : "inativo",
    metadata: agent.metadata ?? {},
  }));

  return NextResponse.json({ agents });
}
