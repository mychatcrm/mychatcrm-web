import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, isOperationalAuditOwner } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!isOperationalAuditOwner(session)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("operational_audit_exports")
    .select("id,status,format,row_count,checksum_sha256,error_code,created_at,completed_at,expires_at")
    .eq("id", id).eq("requested_by_admin_id", session.adminId).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Exportação não encontrada." }, { status: 404 });
  const downloadUrl = data.status === "completed" && data.expires_at && new Date(data.expires_at) > new Date()
    ? `/api/admin/operational-audit/exports/${data.id}/download`
    : null;
  return NextResponse.json({ export: { ...data, downloadUrl } }, { headers: { "Cache-Control": "private, no-store" } });
}
