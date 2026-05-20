import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  let body: { orderedIds?: unknown };
  try {
    body = (await req.json()) as { orderedIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  if (!orderedIds.length) {
    return NextResponse.json({ error: "orderedIds is required" }, { status: 400 });
  }

  const uniqueIds = Array.from(new Set(orderedIds));
  if (uniqueIds.length !== orderedIds.length) {
    return NextResponse.json({ error: "orderedIds contains duplicates" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { data: rules, error: rulesError } = await sb
    .from("lead_distribution_rules")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .in("id", uniqueIds);

  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });
  if ((rules ?? []).length !== uniqueIds.length) {
    return NextResponse.json({ error: "All rules must belong to the current tenant" }, { status: 403 });
  }

  const updates = await Promise.all(
    uniqueIds.map((id, orderIndex) =>
      sb
        .from("lead_distribution_rules")
        .update({ order_index: orderIndex, updated_at: new Date().toISOString() })
        .eq("tenant_id", session.tenantId)
        .eq("id", id),
    ),
  );

  const failed = updates.find((result) => result.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
