import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Deprecated write path. Distribution authorization is exclusively managed by
 * /dashboard/integracoes-leads and lead_distribution_rules.
 */
export async function POST(_req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  return NextResponse.json(
    {
      error:
        "Configure o agente e os formulários em Distribuição de Leads. Esta tela é a única fonte de autorização.",
      code: "use_lead_distribution_rules",
    },
    { status: 409 },
  );
}

/** Removes a form → agent mapping. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const form_id = req.nextUrl.searchParams.get("form_id");
  if (!form_id) {
    return NextResponse.json({ error: "form_id query param required" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("meta_form_agent_mapping")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("form_id", form_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
