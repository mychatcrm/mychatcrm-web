import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type FormMappingBody = {
  form_id: string;
  agent_id: string;
  form_name?: string;
  page_id?: string;
};

/** Upserts a Lead Ads form → agent mapping for the authenticated tenant. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  let body: FormMappingBody;
  try {
    body = (await req.json()) as FormMappingBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { form_id, agent_id, form_name, page_id } = body;
  if (!form_id?.trim() || !agent_id?.trim()) {
    return NextResponse.json({ error: "form_id and agent_id are required" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("meta_form_agent_mapping").upsert(
    {
      tenant_id: session.tenantId,
      form_id: form_id.trim(),
      agent_id: agent_id.trim(),
      form_name: form_name?.trim() ?? null,
      page_id: page_id?.trim() ?? null,
    },
    { onConflict: "tenant_id,form_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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
