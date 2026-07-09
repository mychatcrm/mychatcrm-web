import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { archiveActiveOffer } from "@/lib/server/active-offers-service";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const sb = createSupabaseServiceClient();
    const result = await archiveActiveOffer(sb, session, id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao arquivar lista.";
    const status = message.includes("Sem permissão") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
