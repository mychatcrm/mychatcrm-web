import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  leadRuleClientToDbPayload,
  leadRuleRowToClient,
  type LeadDistributionRuleRow,
} from "@/lib/server/lead-distribution-rules";
import { syncMetaFormAgentMappingForRule } from "@/lib/server/lead-rules-meta-sync";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: { id: string };
};

export async function PUT(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { data: existing, error: existingError } = await sb
    .from("lead_distribution_rules")
    .select("id, order_index")
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .maybeSingle();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  let payload: Record<string, unknown>;
  try {
    payload = leadRuleClientToDbPayload(body, session.tenantId, existing.order_index ?? 999);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid payload" }, { status: 400 });
  }

  delete payload.tenant_id;

  const { data, error } = await sb
    .from("lead_distribution_rules")
    .update(payload)
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .select("*")
    .single<LeadDistributionRuleRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await syncMetaFormAgentMappingForRule(sb, data);

  return NextResponse.json({ rule: leadRuleRowToClient(data) });
}

export async function DELETE(_req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();
  const { data: existing, error: existingError } = await sb
    .from("lead_distribution_rules")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id)
    .maybeSingle();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const { error } = await sb
    .from("lead_distribution_rules")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
