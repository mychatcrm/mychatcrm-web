import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("whatsapp_messages")
    .delete()
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[api/client/conversas/all] DELETE", error.code, error.message);
    return NextResponse.json({ error: "Erro ao limpar conversas." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
