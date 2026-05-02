import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { parsePartnerUpsert } from "@/lib/commercial/admin-payloads";
import { applyPartnerCouponLinks } from "@/lib/commercial/sync-links";
import {
  appendAuditEntry,
  buildCommercialStoreFromDb,
  listCoupons,
  listPartners,
  persistModifiedCoupons,
  upsertPartner,
} from "@/lib/server/commercial-store-db";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const [partners, coupons] = await Promise.all([listPartners(), listCoupons()]);
  return NextResponse.json({ partners, coupons });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const store = await buildCommercialStoreFromDb();
  const existing = typeof body?.id === "string" ? store.partners.find((p) => p.id === body.id) : undefined;
  const parsed = parsePartnerUpsert(body, existing);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const codeUpper = parsed.partner.code.toUpperCase();
  const dup = store.partners.some((p) => p.code.toUpperCase() === codeUpper && p.id !== parsed.partner.id);
  if (dup) return NextResponse.json({ error: "Já existe parceiro com este código." }, { status: 409 });

  for (const cid of parsed.partner.linkedCouponIds) {
    const c = store.coupons.find((x) => x.id === cid);
    if (!c) return NextResponse.json({ error: `Cupom vinculado inválido: ${cid}` }, { status: 400 });
  }

  await upsertPartner(parsed.partner);

  const updated = applyPartnerCouponLinks(store, parsed.partner);
  const changedCoupons = updated.coupons.filter(
    (c, i) => JSON.stringify(c) !== JSON.stringify(store.coupons[i]),
  );
  if (changedCoupons.length > 0) {
    await persistModifiedCoupons(changedCoupons);
  }

  await appendAuditEntry({
    id: `aud_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    adminId: session.adminId,
    adminEmail: session.email,
    action: existing ? "partner_upsert" : "partner_create",
    detail: parsed.partner.code,
  });

  return NextResponse.json({ ok: true, partner: parsed.partner });
}
