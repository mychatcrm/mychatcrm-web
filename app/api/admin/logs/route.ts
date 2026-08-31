import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listAuditLog } from "@/lib/server/commercial-store-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!isOperationalAuditOwner(session)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const filterType = url.searchParams.get("type") ?? "all";
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)));

  const sb = createSupabaseServiceClient();

  const [auditRows, aiErrors] = await Promise.all([
    (filterType === "all" || filterType === "comercial") ? listAuditLog() : Promise.resolve([]),
    (filterType === "all" || filterType === "ia")
      ? sb
          .from("ai_usage_logs")
          .select("id,created_at,tenant_id,agent_id,feature,status,error_code,error_message_sanitized,model,latency_ms")
          .neq("status", "success")
          .order("created_at", { ascending: false })
          .limit(pageSize)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ]);

  const comercialEntries = auditRows.slice(0, pageSize).map((e) => ({
    id: e.id,
    type: "comercial" as const,
    level: "info" as const,
    message: `${e.action} — ${e.detail}`,
    actor: e.adminEmail,
    createdAt: e.createdAt,
  }));

  const iaEntries = (aiErrors as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    type: "ia" as const,
    level: (String(r.status) === "blocked" ? "warn" : "error") as "warn" | "error",
    message: `[IA] ${String(r.feature ?? "")} — ${String(r.error_code ?? r.status)} ${String(r.error_message_sanitized ?? "")}`.trim(),
    actor: String(r.tenant_id ?? ""),
    createdAt: r.created_at as string,
  }));

  const combined = [...comercialEntries, ...iaEntries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, pageSize);

  return NextResponse.json({ logs: combined }, { headers: { "Cache-Control": "no-store" } });
}
