/**
 * POST /api/client/conversas/bulk-delete
 * Arquiva/oculta conversas do inbox sem apagar memória central do CRM.
 */
import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { filterConversationsInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { hideConversationsForTenant } from "@/lib/server/conversation-visibility";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Body inválido (JSON malformado)." }, { status: 400 });
  }

  const raw = (body as { remoteJids?: unknown })?.remoteJids;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "Campo `remoteJids` deve ser um array de strings." }, { status: 400 });
  }

  const jids = Array.from(
    new Set(
      raw
        .filter((j): j is string => typeof j === "string")
        .map((j) => j.trim())
        .filter(Boolean),
    ),
  );

  if (!jids.length) {
    return NextResponse.json({ error: "Lista de remoteJids vazia." }, { status: 400 });
  }
  if (jids.length > MAX_JIDS_PER_CALL) {
    return NextResponse.json({ error: `Máximo de ${MAX_JIDS_PER_CALL} conversas por chamada.` }, { status: 413 });
  }

  const sb = createSupabaseServiceClient();
  // Mesma regra do lote no CRM: se um jid estiver fora do alcance, recusa tudo
  // em vez de arquivar parte em silêncio.
  const inScope = await filterConversationsInScope(
    sb,
    session.tenantId,
    jids,
    await resolveAccessScope(sb, session),
  );
  if (inScope.length !== jids.length) {
    return NextResponse.json(
      { error: "Algumas conversas selecionadas não estão sob a sua responsabilidade." },
      { status: 403 },
    );
  }

  const count = await hideConversationsForTenant({
    sb,
    tenantId: session.tenantId,
    remoteJids: jids,
    archive: true,
    hiddenBy: "conversas_panel",
  });

  return NextResponse.json({ ok: true, count });
}
