import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { applyPartnerCouponLinks } from "@/lib/commercial/sync-links";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  deletePartner,
  persistModifiedCoupons,
} from "@/lib/server/commercial-store-db";
import { randomUUID } from "crypto";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  const store = await buildCommercialStoreFromDb();
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
  const updated = applyPartnerCouponLinks(
    { ...store, partners: store.partners.filter((p) => p.id !== id) },
    cleared,
  );
  const changedCoupons = updated.coupons.filter(
    (c, i) => JSON.stringify(c) !== JSON.stringify(store.coupons[i]),
  );
  if (changedCoupons.length > 0) {
    await persistModifiedCoupons(changedCoupons);
  }

  await deletePartner(id);
  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: session.adminId,
    adminEmail: session.email,
    action: "partner_delete",
    detail: partner.code,
  });

  return NextResponse.json({ ok: true });
}
