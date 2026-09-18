/**
 * GET    /api/client/meta/lead-events/:id — detalhe completo de um lead
 * DELETE /api/client/meta/lead-events/:id — remove da inbox (legado)
 *
 * O detalhe é o único lugar que lê os campos pesados (`form_fields`,
 * `steps_log`, `profile_metadata`). A lista nunca os carrega: o painel antigo
 * devolvia os três para até 1000 leads a cada 15 segundos, e `profile_metadata`
 * ainda embrulha o webhook cru inteiro.
 */
import { NextRequest, NextResponse } from "next/server";
import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";
import { loadCentralEventInScope } from "@/lib/server/meta-lead-central-actions";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { resolveLeadOutcomes } from "@/lib/server/meta-lead-outcome";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const DETAIL_COLUMNS =
  "id, tenant_id, leadgen_id, page_id, page_name, form_id, form_name, campaign_id, campaign_name, " +
  "adset_id, adset_name, ad_id, ad_name, lead_id, name, phone, email, agent_id, agent_resolution_source, " +
  "crm_sync_status, whatsapp_status, current_step, steps_log, form_fields, profile_metadata, " +
  "error_message, created_at, updated_at";

type FormFieldEntry = { key: string; label: string; value: string };

/** Respostas do formulário, normalizadas — estão gravadas desde sempre e nunca foram exibidas. */
function readFormFields(raw: unknown, profile: unknown): FormFieldEntry[] {
  const fromColumn = Array.isArray(raw) ? raw : null;
  const fromProfile =
    !fromColumn && profile && typeof profile === "object"
      ? (profile as { form_fields?: unknown }).form_fields
      : null;
  const source = fromColumn ?? (Array.isArray(fromProfile) ? fromProfile : []);

  const entries: FormFieldEntry[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { key?: unknown; label?: unknown; value?: unknown };
    const key = typeof entry.key === "string" ? entry.key : "";
    const value = typeof entry.value === "string" ? entry.value : "";
    if (!key && !value) continue;
    entries.push({
      key,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label : key,
      value,
    });
  }
  return entries;
}

/** O webhook cru fica fora da resposta: é volumoso e não diz nada ao operador. */
function slimProfileMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const clone = { ...(raw as Record<string, unknown>) };
  delete clone.meta_raw_webhook;
  delete clone.form_fields;
  return clone;
}

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const { id } = await context.params;
  const eventId = id?.trim();
  if (!eventId) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const inScope = await loadCentralEventInScope(sb, session.tenantId, eventId, scope);
  if (!inScope) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const { data, error } = await sb
    .from("meta_lead_events")
    .select(DETAIL_COLUMNS)
    .eq("tenant_id", session.tenantId)
    .eq("id", eventId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  const row = data as unknown as Record<string, unknown>;
  const steps = Array.isArray(row.steps_log) ? row.steps_log : [];

  const leadId = typeof row.lead_id === "string" ? row.lead_id : null;
  const outcomes = leadId
    ? await resolveLeadOutcomes({ sb, tenantId: session.tenantId, leadIds: [leadId] })
    : new Map();

  return NextResponse.json(
    {
      event: {
        ...row,
        steps_log: steps,
        form_fields: readFormFields(row.form_fields, row.profile_metadata),
        profile_metadata: slimProfileMetadata(row.profile_metadata),
        archived_at: inScope.archived_at ?? null,
        outcome: leadId ? (outcomes.get(leadId) ?? null) : null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Apagar de vez. Mantido por compatibilidade com quem já usava o botão
 * "Remover"; a Central usa `/archive`, que preserva o histórico.
 */
export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const guard = await requireCentralAccess();
  if (!guard.ok) return guard.response;
  const { session, sb, scope } = guard;

  const { id } = await context.params;
  const eventId = id?.trim();
  if (!eventId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const event = await loadCentralEventInScope(sb, session.tenantId, eventId, scope);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const { error: deleteErr } = await sb
    .from("meta_lead_events")
    .delete()
    .eq("id", eventId)
    .eq("tenant_id", session.tenantId);

  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  await appendOperationalAuditEvent({
    tenantId: session.tenantId,
    actorType: "customer",
    actorId: actorLabel(session),
    module: "leads.central",
    action: "lead_event.deleted",
    resourceType: "meta_lead_events",
    resourceId: eventId,
    status: "completed",
    severity: "warning",
    integration: "meta_lead_ads",
    metadata: { leadgen_id: event.leadgen_id },
  });

  return NextResponse.json({ ok: true, id: eventId });
}
