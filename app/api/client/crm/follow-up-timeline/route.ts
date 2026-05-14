import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function scheduledAtFromLocal(dataIso: string, hora: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataIso.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!dateMatch || !timeMatch) return null;
  const dt = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export async function POST(request: Request) {
  const session = await getClientSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: {
    leadId?: string;
    type?: string;
    scheduledAt?: string;
    dataIso?: string;
    hora?: string;
    description?: string;
    agentId?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const leadId = body.leadId?.trim();
  const type = body.type?.trim();
  const description = body.description?.trim() ?? null;

  const scheduledAt =
    (typeof body.scheduledAt === "string" && body.scheduledAt.trim()) ||
    (body.dataIso && body.hora ? scheduledAtFromLocal(body.dataIso, body.hora) : null);

  if (!leadId) return NextResponse.json({ error: "leadId é obrigatório" }, { status: 400 });
  if (!type) return NextResponse.json({ error: "type é obrigatório" }, { status: 400 });
  if (!scheduledAt) return NextResponse.json({ error: "scheduledAt inválido" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "description é obrigatória" }, { status: 400 });

  const sb = createSupabaseServiceClient();
  const { data: lead } = await sb
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const { data, error } = await sb
    .from("crm_follow_up_timeline")
    .insert({
      tenant_id: session.tenantId,
      lead_id: leadId,
      type,
      scheduled_at: scheduledAt,
      description,
      agent_id: body.agentId?.trim() || null,
      created_by: session.employeeId ?? session.email ?? null,
    })
    .select("id, type, scheduled_at, description, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Falha ao salvar follow-up" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data });
}
