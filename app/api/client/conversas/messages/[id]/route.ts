import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("whatsapp_messages")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", id);

  if (error) {
    console.error("[api/client/conversas/messages/id] DELETE", error.code, error.message);
    return NextResponse.json({ error: "Erro ao apagar mensagem." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
