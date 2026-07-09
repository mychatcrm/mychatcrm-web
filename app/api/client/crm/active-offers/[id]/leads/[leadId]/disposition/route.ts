import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { applyLeadDisposition } from "@/lib/server/active-offers-service";
import type { ActiveOfferDisposition } from "@/lib/active-offers-types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID_DISPOSITIONS = new Set<ActiveOfferDisposition>([
  "no_answer",
  "answered_transfer",
  "answered_not_interested",
  "do_not_call",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; leadId: string }> },
) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, leadId } = await params;
  if (!id || !leadId) return NextResponse.json({ error: "Parâmetros em falta" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const disposition = typeof body.disposition === "string" ? body.disposition : "";
  if (!VALID_DISPOSITIONS.has(disposition as ActiveOfferDisposition)) {
    return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  }

  const notes = typeof body.notes === "string" ? body.notes : undefined;

  try {
    const sb = createSupabaseServiceClient();
    const result = await applyLeadDisposition(
      sb,
      session,
      id,
      leadId,
      disposition as ActiveOfferDisposition,
      notes,
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao registrar resultado.";
    const status = message.includes("Sem permissão") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
