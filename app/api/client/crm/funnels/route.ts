/**
 * Funis do CRM do tenant.
 *
 * GET  — qualquer sessão autenticada (o painel inteiro precisa resolver nomes
 *        de funil e coluna; o recorte de quem vê qual lead é do access-scope,
 *        não da lista de funis em si).
 * PUT  — substitui a lista. Só o titular da conta, com o teto do plano
 *        validado no servidor (o limite no cliente é conveniência de UI).
 *
 * Antes desta rota os funis existiam apenas no localStorage do navegador de
 * quem os criou — ver `lib/server/crm-funnels-db.ts`.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { getPlanMaxSalesFunnelsForSession } from "@/lib/plan-limits";
import {
  listCrmFunnelsFromDb,
  replaceCrmFunnelsInDb,
  seedCrmFunnelsIfEmpty,
} from "@/lib/server/crm-funnels-db";
import { resolveAllowedFunnelIds } from "@/lib/server/crm-funnel-access-db";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { CrmFunnel } from "@/lib/crm-funnels";

export const dynamic = "force-dynamic";

const MAX_COLUMNS_PER_FUNNEL = 40;

function parseFunnels(value: unknown): CrmFunnel[] | null {
  if (!Array.isArray(value)) return null;

  const funnels: CrmFunnel[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const nome = typeof row.nome === "string" ? row.nome.trim() : "";
    if (!id || !nome) return null;
    if (!Array.isArray(row.columns)) return null;
    if (row.columns.length > MAX_COLUMNS_PER_FUNNEL) return null;

    const columns: CrmFunnel["columns"] = [];
    for (const rawColumn of row.columns) {
      if (!rawColumn || typeof rawColumn !== "object") return null;
      const column = rawColumn as Record<string, unknown>;
      const columnId = typeof column.id === "string" ? column.id.trim() : "";
      const title = typeof column.title === "string" ? column.title.trim() : "";
      if (!columnId || !title) return null;
      columns.push({ id: columnId, title });
    }

    funnels.push({ id, nome, columns });
  }

  // Ids duplicados quebrariam o upsert e deixariam o quadro ambíguo.
  const ids = new Set(funnels.map((f) => f.id));
  if (ids.size !== funnels.length) return null;

  return funnels;
}

export async function GET() {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();
  const funnels = await listCrmFunnelsFromDb(session.tenantId, sb);

  // Titular sempre vê tudo. Colaborador com liberação configurada só recebe
  // os funis liberados — a rota nunca devolve o que ele não pode enxergar,
  // não só esconde na tela.
  if (resolveOrganizationRole(session) !== "owner" && session.employeeId) {
    const allowed = await resolveAllowedFunnelIds(session.tenantId, session.employeeId, sb);
    if (allowed) {
      const allowedSet = new Set(allowed);
      return NextResponse.json(
        { funnels: funnels.filter((funnel) => allowedSet.has(funnel.id)) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return NextResponse.json({ funnels }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  if (resolveOrganizationRole(session) !== "owner") {
    return NextResponse.json(
      { error: "Apenas o titular da conta pode alterar os funis do CRM." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido (JSON malformado)." }, { status: 400 });
  }

  const payload = body as { funnels?: unknown; seedOnly?: unknown } | null;
  const funnels = parseFunnels(payload?.funnels);
  if (!funnels) {
    return NextResponse.json({ error: "Lista de funis inválida." }, { status: 400 });
  }
  if (!funnels.length) {
    return NextResponse.json({ error: "Envie ao menos um funil." }, { status: 400 });
  }

  const max = getPlanMaxSalesFunnelsForSession(session);
  if (funnels.length > max) {
    return NextResponse.json(
      { error: `Seu plano permite até ${max} funis de vendas.` },
      { status: 403 },
    );
  }

  // `seedOnly` é a primeira carga de quem já tinha funis no navegador: só
  // grava se o tenant ainda não tem nada, para nunca sobrescrever o servidor
  // com um localStorage desatualizado de outra máquina.
  if (payload?.seedOnly === true) {
    const seed = await seedCrmFunnelsIfEmpty({ tenantId: session.tenantId, funnels });
    return NextResponse.json({ ok: true, seeded: seed.seeded, funnels: seed.funnels });
  }

  const result = await replaceCrmFunnelsInDb({ tenantId: session.tenantId, funnels });
  if (!result.ok) {
    return NextResponse.json({ error: "Não foi possível salvar os funis." }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    funnels: await listCrmFunnelsFromDb(session.tenantId),
  });
}
