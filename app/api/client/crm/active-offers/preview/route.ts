import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { previewActiveOffer } from "@/lib/server/active-offers-service";
import type { ActiveOfferFilterInput } from "@/lib/active-offers-types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const filter = (typeof body.filter === "object" && body.filter !== null ? body.filter : {}) as ActiveOfferFilterInput;

  try {
    const sb = createSupabaseServiceClient();
    const preview = await previewActiveOffer(sb, session, filter);
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao pré-visualizar lista.";
    const status = message.includes("Sem permissão") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
