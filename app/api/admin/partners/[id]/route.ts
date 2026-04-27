import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { applyPartnerCouponLinks } from "@/lib/commercial/sync-links";
import { appendAudit, readCommercialStore, writeCommercialStore } from "@/lib/server/commercial-store-fs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  const store = readCommercialStore();
  const partner = store.partners.find((p) => p.id === id);
  if (!partner) return NextResponse.json({ error: "Parceiro não encontrado." }, { status: 404 });

  const hasCommitted = store.redemptions.some((r) => r.partnerId === id && r.status === "committed");
  if (hasCommitted) {
    return NextResponse.json(
      { error: "Não é possível excluir parceiro com resgates confirmados. Inative a campanha." },
      { status: 409 },
    );
  }

  const cleared = { ...partner, linkedCouponIds: [] as string[] };
  let next = { ...store, partners: store.partners.filter((p) => p.id !== id) };
  next = applyPartnerCouponLinks(next, cleared);
  next = appendAudit(next, {
    adminId: session.adminId,
    adminEmail: session.email,
    action: "partner_delete",
    detail: partner.code,
  });
  writeCommercialStore(next);
  return NextResponse.json({ ok: true });
}
