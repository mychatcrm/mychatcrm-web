import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { hideConversationsForTenant } from "@/lib/server/conversation-visibility";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Arquivar a caixa inteira do tenant atinge conversa de toda a gente —
  // é ação do titular da conta, não de quem só enxerga a própria equipe.
  if (resolveOrganizationRole(session) !== "owner") {
    return NextResponse.json(
      { error: "Apenas o titular da conta pode arquivar todas as conversas." },
      { status: 403 },
    );
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("remote_jid")
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[api/client/conversas/all] DELETE", error.code, error.message);
    return NextResponse.json({ error: "Erro ao arquivar conversas." }, { status: 503 });
  }

  const jids = Array.from(
    new Set((data ?? []).map((row) => String(row.remote_jid)).filter(Boolean)),
  );

  const count = await hideConversationsForTenant({
    sb,
    tenantId: session.tenantId,
    remoteJids: jids,
    archive: true,
    hiddenBy: "conversas_panel",
  });

  return NextResponse.json({ ok: true, count });
}
