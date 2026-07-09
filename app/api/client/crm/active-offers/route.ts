import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import {
  createActiveOfferFromFilter,
  listActiveOffersForSession,
} from "@/lib/server/active-offers-service";
import type { ActiveOfferDistributionMode, ActiveOfferFilterInput } from "@/lib/active-offers-types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const sb = createSupabaseServiceClient();
    const offers = await listActiveOffersForSession(sb, session);
    return NextResponse.json({ offers });
  } catch (error) {
    console.error("[api/client/crm/active-offers] GET", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar listas de ligação." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const filter = (typeof body.filter === "object" && body.filter !== null ? body.filter : {}) as ActiveOfferFilterInput;
  const assigneeEmployeeIds = Array.isArray(body.assigneeEmployeeIds)
    ? body.assigneeEmployeeIds.filter((id): id is string => typeof id === "string")
    : [];
  const distributionMode =
    body.distributionMode === "split_evenly" ? "split_evenly" : ("shared_pool" as ActiveOfferDistributionMode);

  try {
    const sb = createSupabaseServiceClient();
    const offer = await createActiveOfferFromFilter(sb, session, {
      title,
      filter,
      assigneeEmployeeIds,
      distributionMode,
    });
    return NextResponse.json({ ok: true, offer });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao criar lista.";
    const status = message.includes("Sem permissão") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
