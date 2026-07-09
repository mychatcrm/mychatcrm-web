import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { getOfferProgressBySeller } from "@/lib/server/active-offers-service";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id em falta" }, { status: 400 });

  try {
    const sb = createSupabaseServiceClient();
    const rows = await getOfferProgressBySeller(sb, session, id);
    return NextResponse.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar progresso.";
    const status = message.includes("Sem permissão") ? 403 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
