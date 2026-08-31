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
    .select("status,filename,content_type,payload,expires_at")
    .eq("id", id).eq("requested_by_admin_id", session.adminId).maybeSingle();
  if (error || !data || data.status !== "completed" || !data.payload || !data.expires_at
    || new Date(data.expires_at) <= new Date()) {
    return NextResponse.json({ error: "Arquivo indisponível ou expirado." }, { status: 404 });
  }
  const hex = String(data.payload).replace(/^\\x/, "");
  const bytes = Buffer.from(hex, "hex");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": data.content_type ?? "application/gzip",
      "Content-Disposition": `attachment; filename="${String(data.filename ?? "auditoria.ndjson.gz").replaceAll('"', '')}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
