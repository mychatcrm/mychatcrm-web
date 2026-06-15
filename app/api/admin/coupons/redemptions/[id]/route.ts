import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { deleteRedemption } from "@/lib/server/commercial-store-db";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "cupons")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    await deleteRedemption(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao apagar registro.";
    console.error("[admin-redemptions-delete]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
