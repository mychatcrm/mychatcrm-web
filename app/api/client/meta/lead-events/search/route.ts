/**
 * GET /api/client/meta/lead-events/search
 *
 * Página da Central de Leads. Ao contrário da rota antiga (`limit=1000` com
 * filtro no navegador), aqui o recorte inteiro é SQL: período no fuso do
 * tenant, campanha/conjunto/anúncio/formulário/página, estado, agente, busca e
 * arquivamento. Paginação por keyset — offset em tabela que cresce todo dia
 * fica lento e repete linhas quando chega lead novo durante a navegação.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import {
  CENTRAL_DEFAULT_PAGE_SIZE,
  CENTRAL_MAX_PAGE_SIZE,
  countMetaLeadEvents,
  hasArchiveSupport,
  searchMetaLeadEvents,
  type CentralCursor,
} from "@/lib/server/meta-lead-central";
import { parseCentralFilters } from "@/lib/meta-leads/central-filters";
import { resolveLeadIdsForOutcomes, resolveLeadOutcomes } from "@/lib/server/meta-lead-outcome";

export const dynamic = "force-dynamic";

function parseCursor(raw: string | null): CentralCursor | null {
  if (!raw?.trim()) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") return null;
    if (Number.isNaN(new Date(decoded.createdAt).getTime())) return null;
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(cursor: CentralCursor | null): string | null {
  return cursor ? Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url") : null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const params = req.nextUrl.searchParams;
  const filters = parseCentralFilters(params);
  const cursor = parseCursor(params.get("cursor"));
  const limitRaw = Number(params.get("limit") ?? CENTRAL_DEFAULT_PAGE_SIZE);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(CENTRAL_MAX_PAGE_SIZE, Math.max(1, Math.floor(limitRaw)))
    : CENTRAL_DEFAULT_PAGE_SIZE;
  // A contagem exata é a consulta cara: só na primeira página do recorte.
  const withTotal = !cursor && params.get("total") !== "0";

  try {
    // O desfecho vive no CRM: resolve-se primeiro em ids de lead e entra na
    // consulta como restrição, para a paginação continuar correta.
    const leadIdFilter = filters.outcomes.length
      ? await resolveLeadIdsForOutcomes({ sb, tenantId: session.tenantId, outcomes: filters.outcomes })
      : null;

    const [page, archiveSupported] = await Promise.all([
      searchMetaLeadEvents({ sb, tenantId: session.tenantId, scope, filters, cursor, limit, leadIdFilter }),
      hasArchiveSupport(sb),
    ]);

    // Resultado comercial só das linhas desta página — a junção é barata assim
    // e a lista continua a não carregar nada pesado do webhook.
    const outcomes = await resolveLeadOutcomes({
      sb,
      tenantId: session.tenantId,
      leadIds: page.rows.map((row) => row.lead_id).filter((id): id is string => Boolean(id)),
    });

    const rows = page.rows.map((row) => {
      const outcome = row.lead_id ? outcomes.get(row.lead_id) : undefined;
      return {
        ...row,
        outcome: outcome?.outcome ?? null,
        outcome_owner: outcome?.ownerName ?? null,
        outcome_team: outcome?.teamName ?? null,
        outcome_column: outcome?.columnLabel ?? null,
        outcome_first_reply_minutes: outcome?.firstReplyMinutes ?? null,
        outcome_scheduled_at: outcome?.scheduledAt ?? null,
      };
    });

    let total: number | null = null;
    let totalExact = true;
    if (withTotal) {
      const counted = await countMetaLeadEvents({
        sb,
        tenantId: session.tenantId,
        scope,
        filters,
        leadIdFilter,
      });
      total = counted.total;
      totalExact = counted.exact;
    }

    return NextResponse.json(
      {
        rows,
        nextCursor: encodeCursor(page.nextCursor),
        total,
        totalExact,
        scopeApplied: page.scopeApplied,
        archiveSupported,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    // Tabela ainda não criada num ambiente novo não é erro do utilizador.
    if (message.includes("PGRST205") || message.includes("42P01")) {
      return NextResponse.json({
        rows: [], nextCursor: null, total: 0, totalExact: true,
        scopeApplied: false, archiveSupported: false, tableReady: false,
      });
    }
    console.error("[meta-lead-central] search_failed", { tenant_id: session.tenantId, message });
    return NextResponse.json({ error: "Não foi possível carregar a Central de Leads." }, { status: 500 });
  }
}
