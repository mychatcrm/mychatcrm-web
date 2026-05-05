import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PlanConfig = {
  planSlug: string;
  agentLimit: number;
  followupLimit: number;
  keywordLimit: number;
  features: {
    lead_ads: boolean;
    click_to_whatsapp: boolean;
    qr_codes: boolean;
    followup_auto: boolean;
  };
};

function dbToConfig(row: Record<string, unknown>): PlanConfig {
  const raw = (row.features as Record<string, boolean>) ?? {};
  return {
    planSlug: row.plan_slug as string,
    agentLimit: Number(row.agent_limit ?? 1),
    followupLimit: Number(row.followup_limit ?? 1),
    keywordLimit: Number(row.keyword_limit ?? 1),
    features: {
      lead_ads: Boolean(raw.lead_ads),
      click_to_whatsapp: Boolean(raw.click_to_whatsapp),
      qr_codes: Boolean(raw.qr_codes),
      followup_auto: Boolean(raw.followup_auto),
    },
  };
}

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "planos")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("admin_plan_config")
    .select("*")
    .order("plan_slug", { ascending: true });

  if (error) {
    console.error("[admin/plan-config] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar configuração de planos." }, { status: 500 });
  }

  return NextResponse.json(
    { plans: (data ?? []).map(dbToConfig) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "planos")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const planSlug = String(body.planSlug ?? "").trim();
  if (!planSlug) return NextResponse.json({ error: "planSlug obrigatório." }, { status: 400 });

  const agentLimit = Number(body.agentLimit);
  const followupLimit = Number(body.followupLimit);
  const keywordLimit = Number(body.keywordLimit);

  if (!Number.isInteger(agentLimit) || agentLimit < 1) {
    return NextResponse.json({ error: "agentLimit deve ser inteiro >= 1." }, { status: 400 });
  }
  if (!Number.isInteger(followupLimit) || followupLimit < 1) {
    return NextResponse.json({ error: "followupLimit deve ser inteiro >= 1." }, { status: 400 });
  }
  if (!Number.isInteger(keywordLimit) || keywordLimit < 1) {
    return NextResponse.json({ error: "keywordLimit deve ser inteiro >= 1." }, { status: 400 });
  }

  const rawFeatures = body.features as Record<string, unknown> | null;
  const features = rawFeatures
    ? {
        lead_ads: Boolean(rawFeatures.lead_ads),
        click_to_whatsapp: Boolean(rawFeatures.click_to_whatsapp),
        qr_codes: Boolean(rawFeatures.qr_codes),
        followup_auto: Boolean(rawFeatures.followup_auto),
      }
    : undefined;

  const sb = createSupabaseServiceClient();
  const updatePayload: Record<string, unknown> = {
    plan_slug: planSlug,
    agent_limit: agentLimit,
    followup_limit: followupLimit,
    keyword_limit: keywordLimit,
    updated_at: new Date().toISOString(),
    updated_by: session.adminId,
  };
  if (features) updatePayload.features = features;

  const { error } = await sb
    .from("admin_plan_config")
    .upsert(updatePayload, { onConflict: "plan_slug" });

  if (error) {
    console.error("[admin/plan-config] PATCH:", error.message);
    return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
