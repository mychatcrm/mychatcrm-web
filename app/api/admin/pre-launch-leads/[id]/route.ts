import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "leads-lancamento")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Id obrigatório." }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("pre_launch_leads").delete().eq("id", id);
  if (error) {
    console.error("[admin/pre-launch-leads/:id] DELETE:", error.message);
    return NextResponse.json({ error: "Falha ao apagar o lead." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
