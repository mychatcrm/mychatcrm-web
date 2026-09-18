import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AccessScope } from "@/lib/server/access-scope";
import { leadInScope, scopeMatchesNothing, SCOPABLE_LEAD_COLUMNS } from "@/lib/server/access-scope";
import { hasArchiveSupport, isMissingSchemaError } from "@/lib/server/meta-lead-central";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type CentralEventRef = {
  id: string;
  lead_id: string | null;
  leadgen_id: string;
  archived_at?: string | null;
};

/**
 * Carrega o evento já validado contra o recorte de acesso.
 *
 * Devolve `null` tanto quando não existe como quando está fora do escopo — o
 * chamador responde 404 nos dois casos, para não confirmar a existência de um
 * lead de outra equipe. Evento sem `lead_id` (bloqueado antes do CRM) só o
 * titular alcança, igual ao lead legado sem equipe.
 */
export async function loadCentralEventInScope(
  sb: SupabaseServiceClient,
  tenantId: string,
  eventId: string,
  scope: AccessScope,
  options: { withArchive?: boolean } = {},
): Promise<CentralEventRef | null> {
  if (scopeMatchesNothing(scope)) return null;

  const withArchive = options.withArchive ?? (await hasArchiveSupport(sb));
  const columns = withArchive ? "id, lead_id, leadgen_id, archived_at" : "id, lead_id, leadgen_id";

  const { data, error } = await sb
    .from("meta_lead_events")
    .select(columns)
    .eq("tenant_id", tenantId)
    .eq("id", eventId)
    .maybeSingle();

  if (error || !data) return null;
  const event = data as unknown as CentralEventRef;

  if (scope.kind === "all") return event;
  if (!event.lead_id) return null;

  const { data: lead } = await sb
    .from("leads")
    .select(SCOPABLE_LEAD_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", event.lead_id)
    .maybeSingle();

  if (!lead) return null;
  return leadInScope(lead as never, scope) ? event : null;
}

export type ArchiveOutcome =
  | { ok: true; updated: number }
  | { ok: false; code: "schema_pending" | "not_found" | "failed"; message: string };

/**
 * Arquiva (ou desarquiva) eventos da Central.
 *
 * Substitui o DELETE do painel antigo, que apagava a linha de vez atrás de um
 * `window.confirm`: a Central é a fonte da verdade do lead pago e não pode
 * perder histórico por engano. Arquivado sai da lista padrão, continua no
 * export e no filtro "Arquivados", e o movimento fica na auditoria.
 */
export async function setCentralEventsArchived(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  eventIds: string[];
  archived: boolean;
  actorId: string;
  scope: AccessScope;
}): Promise<ArchiveOutcome> {
  const { sb, tenantId, eventIds, archived, actorId, scope } = params;
  if (eventIds.length === 0) return { ok: true, updated: 0 };

  if (!(await hasArchiveSupport(sb))) {
    return {
      ok: false,
      code: "schema_pending",
      message:
        "Arquivamento indisponível: falta aplicar a migração 20260918000000_leads_central_v1 no banco.",
    };
  }

  // Cada id passa pelo recorte antes de ser tocado — a ação em massa não pode
  // virar a porta dos fundos para mexer em lead de outra equipe. Para o titular
  // não há recorte a verificar, e verificar mesmo assim transformava 500 ids em
  // mil consultas sequenciais; o `eq(tenant_id)` do update já é a fronteira.
  let allowedIds: string[];
  if (scope.kind === "all") {
    allowedIds = eventIds;
  } else {
    const allowed: CentralEventRef[] = [];
    for (const eventId of eventIds) {
      const event = await loadCentralEventInScope(sb, tenantId, eventId, scope, { withArchive: true });
      if (event) allowed.push(event);
    }
    allowedIds = allowed.map((event) => event.id);
  }
  if (allowedIds.length === 0) return { ok: false, code: "not_found", message: "Nenhum lead encontrado." };

  const { error } = await sb
    .from("meta_lead_events")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      archived_by: archived ? actorId.slice(0, 120) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .in("id", allowedIds);

  if (error) {
    if (isMissingSchemaError(error)) {
      return { ok: false, code: "schema_pending", message: "Arquivamento indisponível: migração pendente." };
    }
    return { ok: false, code: "failed", message: error.message };
  }

  await appendOperationalAuditEvent({
    tenantId,
    actorType: "customer",
    actorId,
    module: "leads.central",
    action: archived ? "lead_event.archived" : "lead_event.restored",
    resourceType: "meta_lead_events",
    resourceId: allowedIds.length === 1 ? allowedIds[0] : null,
    status: "completed",
    severity: "info",
    integration: "meta_lead_ads",
    metadata: { count: allowedIds.length },
  });

  return { ok: true, updated: allowedIds.length };
}
