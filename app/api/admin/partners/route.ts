import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { parsePartnerUpsert } from "@/lib/commercial/admin-payloads";
import { applyPartnerCouponLinks } from "@/lib/commercial/sync-links";
import { appendAudit, readCommercialStore, writeCommercialStore } from "@/lib/server/commercial-store-fs";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const store = readCommercialStore();
  return NextResponse.json({ partners: store.partners, coupons: store.coupons });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "parcerias")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const store = readCommercialStore();
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

  let next: typeof store = {
    ...store,
    partners: store.partners.some((p) => p.id === parsed.partner.id)
      ? store.partners.map((p) => (p.id === parsed.partner.id ? parsed.partner : p))
      : [...store.partners, parsed.partner],
  };

  next = applyPartnerCouponLinks(next, parsed.partner);
  next = appendAudit(next, {
    adminId: session.adminId,
    adminEmail: session.email,
    action: existing ? "partner_upsert" : "partner_create",
    detail: parsed.partner.code,
  });

  writeCommercialStore(next);
  return NextResponse.json({ ok: true, partner: parsed.partner });
}
