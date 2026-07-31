import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationInScope, resolveAccessScope } from "@/lib/server/access-scope";
import { buildNewLeadCrmFields } from "@/lib/server/crm-lead-lifecycle";
import {
  commitTenantLeadQuotaReservation,
  releaseTenantLeadQuotaReservation,
  reserveTenantLeadQuota,
} from "@/lib/server/lead-quota";

export const dynamic = "force-dynamic";

function phoneFromJid(remoteJid: string): string {
  return (remoteJid.split("@")[0] ?? remoteJid).replace(/\D/g, "");
}

function safeName(value: unknown, phone: string): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  return phone;
}

export async function POST(
  request: Request,
  { params }: { params: { jid: string } },
) {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const remoteJid = decodeURIComponent(params.jid);
  const phone = phoneFromJid(remoteJid);
  if (phone.length < 8) {
    return NextResponse.json({ error: "Contato inválido" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const sb = createSupabaseServiceClient();
  if (!(await conversationInScope(sb, session.tenantId, remoteJid, await resolveAccessScope(sb, session)))) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const { data: state } = await sb
    .from("conversation_states")
    .select("agent_id, active_journey_id")
    .eq("tenant_id", session.tenantId)
    .eq("remote_jid", remoteJid)
    .eq("channel", "whatsapp")
    .maybeSingle();

  const { data: existing, error: existingError } = await sb
    .from("leads")
    .select("id, name, phone, status, crm_funnel_id")
    .eq("tenant_id", session.tenantId)
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: "Não foi possível consultar o CRM." }, { status: 503 });
  }

  let lead = existing;
  if (!lead) {
    const admission = await reserveTenantLeadQuota({
      tenantId: session.tenantId,
      plan: session.plan,
      operationalLimits: session.operationalLimits,
      contactKey: phone,
      source: "crm_manual",
      idempotencyKey: `crm-manual:${session.tenantId}:${phone}`,
      metadata: { remote_jid: remoteJid, saved_by: session.email },
    });
    if (!admission.admitted) {
      return NextResponse.json(
        {
          error:
            admission.reason === "lead_quota_exhausted"
              ? "O limite de novos leads do ciclo foi atingido. Contrate mais capacidade para salvar este contato no CRM."
              : "Não foi possível confirmar a franquia de leads. Tente novamente em instantes.",
          code: admission.reason,
        },
        { status: admission.reason === "lead_quota_exhausted" ? 429 : 503 },
      );
    }
    const { data, error } = await sb
      .from("leads")
      .insert({
        tenant_id: session.tenantId,
        phone,
        name: safeName(body.name, phone),
        source: "whatsapp_manual",
        agent_id:
          state && typeof state.agent_id === "string" ? state.agent_id : null,
        agent_assignment_source: "manual_conversation_save",
        last_seen: now,
        updated_at: now,
        ...buildNewLeadCrmFields("funil-default"),
      })
      .select("id, name, phone, status, crm_funnel_id")
      .single();
    if (error || !data) {
      await releaseTenantLeadQuotaReservation(admission.eventId, "manual_crm_insert_failed");
      return NextResponse.json(
        { error: error?.message ?? "Não foi possível salvar o contato no CRM." },
        { status: 503 },
      );
    }
    lead = data;
    await commitTenantLeadQuotaReservation({ eventId: admission.eventId, leadId: lead.id });
  } else if (
    (!lead.name || lead.name === lead.phone) &&
    typeof body.name === "string" &&
    body.name.trim()
  ) {
    const { data } = await sb
      .from("leads")
      .update({ name: safeName(body.name, phone), updated_at: now })
      .eq("tenant_id", session.tenantId)
      .eq("id", lead.id)
      .select("id, name, phone, status, crm_funnel_id")
      .single();
    if (data) lead = data;
  }

  await Promise.all([
    sb
      .from("whatsapp_messages")
      .update({ lead_id: lead.id })
      .eq("tenant_id", session.tenantId)
      .eq("remote_jid", remoteJid),
    sb
      .from("conversation_states")
      .update({ lead_id: lead.id, updated_at: now })
      .eq("tenant_id", session.tenantId)
      .eq("remote_jid", remoteJid)
      .eq("channel", "whatsapp"),
    sb
      .from("lead_journeys")
      .update({ lead_id: lead.id, updated_at: now })
      .eq("tenant_id", session.tenantId)
      .eq("remote_jid", remoteJid),
  ]);

  return NextResponse.json({
    ok: true,
    created: !existing,
    lead,
  });
}
