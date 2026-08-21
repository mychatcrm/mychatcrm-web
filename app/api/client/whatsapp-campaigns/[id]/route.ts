/**
 * DELETE /api/client/whatsapp-campaigns/[id]
 *
 * Apaga o disparo de vez. Antes esta rota só marcava `status = 'cancelled'` —
 * herança de quando a ação na tela era "cancelar campanha". Depois que o card
 * passou a ter um botão "Excluir" (que avisa "não dá pra desfazer"), isso
 * virou mentira na interface: o card continuava lá, morto, sem play. Pior no
 * editar, que apaga a antiga e recria — o cliente terminava com duas cópias,
 * uma delas eternamente "Cancelado".
 *
 * Também não filtra mais por status: "excluir" vale pra qualquer disparo,
 * inclusive pausado e concluído. O filtro antigo (`draft/scheduled/processing`)
 * fazia o botão devolver 404 justamente nos estados em que o cliente mais
 * quer limpar a tela.
 *
 * Os destinatários somem junto por `ON DELETE CASCADE` na FK.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("whatsapp_campaigns")
    .delete()
    .eq("tenant_id", guard.session.tenantId)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
