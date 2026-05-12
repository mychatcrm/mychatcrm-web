/**
 * POST /api/client/conversas/bulk-delete
 *
 * Apaga todas as mensagens de UM conjunto de remoteJids para o tenant
 * autenticado. Usado pelo modo "Selecionar conversas" na UI.
 *
 * Body: { remoteJids: string[] }
 * Resp: { ok: true, count: number }
 *
 * Importante: este endpoint NÃO toca na tabela `leads` nem em nenhuma
 * outra tabela do CRM. Apenas remove linhas de `whatsapp_messages`.
 * Isso é por design — o usuário pode querer "limpar conversa" mas
 * manter o lead/contato no CRM.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Limite defensivo para evitar query gigante. O usuário típico tem
// dezenas a poucas centenas de conversas; 500 cobre folgadamente o caso
// "selecionei tudo".
const MAX_JIDS_PER_CALL = 500;

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (JSON malformado)." },
      { status: 400 },
    );
  }

  const raw = (body as { remoteJids?: unknown })?.remoteJids;
  if (!Array.isArray(raw)) {
    return NextResponse.json(
      { error: "Campo `remoteJids` deve ser um array de strings." },
      { status: 400 },
    );
  }

  // Sanitiza: aceita apenas strings não vazias, deduplica e aplica teto.
  const jids = Array.from(
    new Set(
      raw
        .filter((j): j is string => typeof j === "string")
        .map((j) => j.trim())
        .filter(Boolean),
    ),
  );

  if (jids.length === 0) {
    return NextResponse.json(
      { error: "Lista de remoteJids vazia." },
      { status: 400 },
    );
  }

  if (jids.length > MAX_JIDS_PER_CALL) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_JIDS_PER_CALL} conversas por chamada.` },
      { status: 413 },
    );
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("whatsapp_messages")
    .delete()
    .eq("tenant_id", session.tenantId)
    .in("remote_jid", jids);

  if (error) {
    console.error(
      "[api/client/conversas/bulk-delete] POST",
      error.code,
      error.message,
    );
    return NextResponse.json(
      { error: "Erro ao apagar conversas selecionadas." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, count: jids.length });
}
