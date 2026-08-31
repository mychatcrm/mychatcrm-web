import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ traceId: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!isOperationalAuditOwner(session)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { traceId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(traceId)) return NextResponse.json({ error: "Trace inválido." }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("operational_audit_events")
    .select("id,operation_id,trace_id,span_id,parent_span_id,occurred_at,tenant_id,actor_type,actor_id,module,action,resource_type,resource_id,status,severity,is_critical,channel,integration,duration_ms,attempt,result_code,related_ids,metadata,deployment_sha")
    .eq("trace_id", traceId)
    .order("occurred_at", { ascending: true })
    .limit(1_000);
  if (error) return NextResponse.json({ error: "Falha ao consultar a trajetória." }, { status: 500 });
  return NextResponse.json({ traceId, events: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
