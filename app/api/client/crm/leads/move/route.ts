import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { loadLeadInScope, resolveAccessScope, scopeMatchesNothing } from "@/lib/server/access-scope";
import { listCrmFunnelsFromDb } from "@/lib/server/crm-funnels-db";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean || null;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) return undefined;
  return value;
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

  const leadId = requiredText(body.leadId);
  const funilId = requiredText(body.funilId);
  const status = requiredText(body.status);
  const previousLeadId = optionalUuid(body.previousLeadId);
  const nextLeadId = optionalUuid(body.nextLeadId);
  if (!leadId || !UUID.test(leadId) || !funilId || !status || previousLeadId === undefined || nextLeadId === undefined) {
    return NextResponse.json({ error: "Movimentação inválida." }, { status: 400 });
  }
  if (previousLeadId === leadId || nextLeadId === leadId || (previousLeadId && previousLeadId === nextLeadId)) {
    return NextResponse.json({ error: "Posição de destino inválida." }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const scope = await resolveAccessScope(sb, session);
  if (scopeMatchesNothing(scope) || !(await loadLeadInScope(sb, session.tenantId, leadId, scope))) {
    return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  }

  if (scope.kind !== "all" && scope.funnelIds?.length && !scope.funnelIds.includes(funilId)) {
    return NextResponse.json({ error: "Funil não permitido para este usuário." }, { status: 403 });
  }

  const funnel = (await listCrmFunnelsFromDb(session.tenantId, sb)).find((item) => item.id === funilId);
  if (!funnel || !funnel.columns.some((column) => column.id === status)) {
    return NextResponse.json({ error: "Funil ou etapa de destino inválidos." }, { status: 400 });
  }

  for (const neighborId of [previousLeadId, nextLeadId]) {
    if (neighborId && !(await loadLeadInScope(sb, session.tenantId, neighborId, scope))) {
      return NextResponse.json({ error: "Card vizinho não encontrado." }, { status: 404 });
    }
  }

  const startedAt = Date.now();
  const { data, error } = await sb.rpc("move_crm_lead_card_v1", {
    p_tenant_id: session.tenantId,
    p_lead_id: leadId,
    p_funnel_id: funilId,
    p_status: status,
    p_previous_lead_id: previousLeadId,
    p_next_lead_id: nextLeadId,
  });

  if (error) {
    console.error("[crm-card-move] failed", {
      tenant_id: session.tenantId,
      lead_id: leadId,
      code: error.code,
      duration_ms: Date.now() - startedAt,
    });
    if (error.code === "P0002") return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
    if (error.code === "22023" || error.code === "40001") {
      return NextResponse.json(
        { error: "A coluna mudou enquanto você movia o card. Tente novamente." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Não foi possível salvar a posição do card." }, { status: 503 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return NextResponse.json({ error: "Movimentação não confirmada." }, { status: 503 });
  }
  const result = row as Record<string, unknown>;
  const crmPosition = Number(result.card_position);
  if (!Number.isFinite(crmPosition)) {
    return NextResponse.json({ error: "Posição inválida devolvida pelo servidor." }, { status: 503 });
  }

  console.info("[crm-card-move] committed", {
    tenant_id: session.tenantId,
    lead_id: leadId,
    funnel_id: funilId,
    column_id: status,
    duration_ms: Date.now() - startedAt,
  });

  return NextResponse.json({
    lead: {
      id: String(result.lead_id),
      funilId: String(result.funnel_id),
      status: String(result.column_id),
      crmPosition,
    },
  });
}
