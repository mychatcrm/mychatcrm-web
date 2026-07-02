import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .select("whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out_at")
    .eq("tenant_id", guard.session.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  return NextResponse.json({ optIn: data });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    source?: string;
  };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled é obrigatório." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const source = body.source?.trim().slice(0, 120) || "crm_manual_confirmation";
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("leads")
    .update(
      body.enabled
        ? {
            whatsapp_opt_in: true,
            whatsapp_opt_in_at: now,
            whatsapp_opt_in_source: source,
            whatsapp_opt_out_at: null,
            updated_at: now,
          }
        : {
            whatsapp_opt_in: false,
            whatsapp_opt_out_at: now,
            updated_at: now,
          },
    )
    .eq("tenant_id", guard.session.tenantId)
    .eq("id", id)
    .select("whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true, optIn: data });
}
