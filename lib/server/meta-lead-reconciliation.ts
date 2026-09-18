import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { metaGraphErrorCode, metaGraphRequest } from "@/lib/server/meta-graph-api";
import { processMetaLeadgenEvent } from "@/lib/server/meta-lead-ingest";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { zonedDayEndExclusiveISO, zonedDayStartISO } from "@/lib/meta-leads/central-filters";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Reconciliação Meta ↔ MyChatCRM.
 *
 * Pergunta à Meta, formulário a formulário, quais leads ela registou num
 * período, e compara com o que está em `meta_lead_events`. A diferença é o que
 * o cliente perdeu — por conexão expirada, formulário fora das regras, webhook
 * que não chegou ou lead que ficou em dead-letter — e que hoje é invisível no
 * painel: ele só nota que "entrou menos lead" e não tem como provar nem
 * recuperar.
 *
 * A importação do que falta é um segundo passo, deliberado e sob comando, e por
 * omissão **não** aciona o primeiro contato automático.
 */

export const RECONCILIATION_MAX_DAYS = 90;
const MAX_PAGES = 25;
const MAX_FORMS_PER_PAGE = 60;
const MAX_LEADS_PER_FORM = 3000;
const GRAPH_PAGE_SIZE = 100;
const LOCAL_LOOKUP_CHUNK = 200;
const GRAPH_TIMEOUT_MS = 12_000;

export type ReconciliationRunRow = {
  id: string;
  tenant_id: string;
  period_from: string;
  period_to: string;
  timezone: string;
  status: "running" | "completed" | "failed" | "partial";
  pages_checked: number;
  forms_checked: number;
  meta_total: number;
  local_total: number;
  missing_total: number;
  imported_total: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  started_by: string | null;
};

export type ReconciliationGapRow = {
  id: string;
  run_id: string;
  page_id: string;
  form_id: string | null;
  form_name: string | null;
  leadgen_id: string;
  lead_created_time: string | null;
  ad_id: string | null;
  status: "missing" | "imported" | "import_failed" | "skipped";
  import_error: string | null;
};

type MetaConnectionRow = {
  tenant_id: string;
  page_id: string;
  page_name: string | null;
  page_access_token: string | null;
};

type GraphForm = { id?: string; name?: string };
type GraphLeadRef = { id?: string; created_time?: string; ad_id?: string };
type GraphList<T> = { data?: T[]; paging?: { next?: string } };

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

export function isReconciliationSchemaMissing(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

/** Percorre uma coleção da Graph API seguindo `paging.next`, com teto rígido. */
async function collectGraphList<T>(params: {
  path: string;
  accessToken: string;
  searchParams: Record<string, string | number>;
  max: number;
}): Promise<T[]> {
  const collected: T[] = [];
  let next: string | null = null;

  for (let round = 0; round < 60 && collected.length < params.max; round += 1) {
    const response: GraphList<T> = await metaGraphRequest<GraphList<T>>(next ?? params.path, {
      accessToken: params.accessToken,
      searchParams: next ? undefined : params.searchParams,
      timeoutMs: GRAPH_TIMEOUT_MS,
    });
    const batch = response.data ?? [];
    collected.push(...batch);
    next = typeof response.paging?.next === "string" ? response.paging.next : null;
    if (!next || batch.length === 0) break;
  }

  return collected.slice(0, params.max);
}

function toUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Leads que o MyChatCRM já tem, consultados por leadgen_id em lotes. */
async function loadKnownLeadgenIds(
  sb: SupabaseServiceClient,
  tenantId: string,
  leadgenIds: string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  for (let index = 0; index < leadgenIds.length; index += LOCAL_LOOKUP_CHUNK) {
    const chunk = leadgenIds.slice(index, index + LOCAL_LOOKUP_CHUNK);
    const { data, error } = await sb
      .from("meta_lead_events")
      .select("leadgen_id")
      .eq("tenant_id", tenantId)
      .in("leadgen_id", chunk);
    if (error) throw new Error(`reconciliation_local_lookup_failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ leadgen_id?: unknown }>) {
      if (typeof row.leadgen_id === "string") known.add(row.leadgen_id);
    }
  }
  return known;
}

export type ReconciliationResult = {
  run: ReconciliationRunRow;
  gaps: ReconciliationGapRow[];
};

export async function runMetaLeadReconciliation(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  from: string;
  to: string;
  timezone: string;
  startedBy: string;
}): Promise<ReconciliationResult> {
  const { sb, tenantId, from, to, timezone, startedBy } = params;

  const fromISO = zonedDayStartISO(from, timezone);
  const toISO = zonedDayEndExclusiveISO(to, timezone);
  if (!fromISO || !toISO) throw new Error("reconciliation_invalid_period");

  const { data: runRow, error: runError } = await sb
    .from("meta_lead_reconciliation_runs")
    .insert({
      tenant_id: tenantId,
      period_from: from,
      period_to: to,
      timezone,
      status: "running",
      started_by: startedBy.slice(0, 120),
    })
    .select("*")
    .maybeSingle();

  if (runError) {
    if (isReconciliationSchemaMissing(runError)) throw new Error("reconciliation_schema_pending");
    // Índice parcial único: já existe uma execução em curso para este tenant.
    if (runError.code === "23505") throw new Error("reconciliation_already_running");
    throw new Error(`reconciliation_run_insert_failed: ${runError.message}`);
  }

  const run = runRow as unknown as ReconciliationRunRow;
  let pagesChecked = 0;
  let formsChecked = 0;
  let metaTotal = 0;
  let partial = false;

  type Candidate = {
    pageId: string;
    formId: string | null;
    formName: string | null;
    leadgenId: string;
    createdTime: string | null;
    adId: string | null;
  };
  const candidates: Candidate[] = [];

  try {
    const { data: connectionRows, error: connectionError } = await sb
      .from("meta_connections")
      .select("tenant_id, page_id, page_name, page_access_token")
      .eq("tenant_id", tenantId)
      .limit(MAX_PAGES);
    if (connectionError) throw new Error(`reconciliation_connections_failed: ${connectionError.message}`);

    const connections = ((connectionRows ?? []) as MetaConnectionRow[]).filter((connection) =>
      Boolean(connection.page_access_token?.trim()),
    );
    if (connections.length === 0) throw new Error("reconciliation_no_connection");

    const fromUnix = toUnixSeconds(fromISO);
    const toMs = new Date(toISO).getTime();

    for (const connection of connections) {
      const token = connection.page_access_token as string;
      pagesChecked += 1;

      let forms: GraphForm[] = [];
      try {
        forms = await collectGraphList<GraphForm>({
          path: `/${encodeURIComponent(connection.page_id)}/leadgen_forms`,
          accessToken: token,
          searchParams: { fields: "id,name", limit: GRAPH_PAGE_SIZE },
          max: MAX_FORMS_PER_PAGE,
        });
      } catch (error) {
        // Uma página sem permissão não pode cancelar a reconciliação das outras.
        partial = true;
        console.warn("[meta-reconciliation] forms_failed", {
          tenant_id: tenantId,
          page_id: connection.page_id,
          code: metaGraphErrorCode(error),
        });
        continue;
      }

      for (const form of forms) {
        const formId = form.id?.trim();
        if (!formId) continue;
        formsChecked += 1;

        let leads: GraphLeadRef[] = [];
        try {
          leads = await collectGraphList<GraphLeadRef>({
            path: `/${encodeURIComponent(formId)}/leads`,
            accessToken: token,
            searchParams: {
              fields: "id,created_time,ad_id",
              limit: GRAPH_PAGE_SIZE,
              filtering: JSON.stringify([
                { field: "time_created", operator: "GREATER_THAN", value: fromUnix },
              ]),
            },
            max: MAX_LEADS_PER_FORM,
          });
        } catch (error) {
          partial = true;
          console.warn("[meta-reconciliation] leads_failed", {
            tenant_id: tenantId,
            form_id: formId,
            code: metaGraphErrorCode(error),
          });
          continue;
        }

        for (const lead of leads) {
          const leadgenId = lead.id?.trim();
          if (!leadgenId) continue;
          // O filtro da Graph só corta o início; o fim do período é aqui.
          const createdMs = lead.created_time ? new Date(lead.created_time).getTime() : Number.NaN;
          if (Number.isFinite(createdMs) && createdMs >= toMs) continue;
          metaTotal += 1;
          candidates.push({
            pageId: connection.page_id,
            formId,
            formName: form.name?.trim() || null,
            leadgenId,
            createdTime: lead.created_time ?? null,
            adId: lead.ad_id?.trim() || null,
          });
        }
      }
    }

    const known = await loadKnownLeadgenIds(
      sb,
      tenantId,
      candidates.map((candidate) => candidate.leadgenId),
    );
    const missing = candidates.filter((candidate) => !known.has(candidate.leadgenId));

    if (missing.length > 0) {
      const { error: gapsError } = await sb.from("meta_lead_reconciliation_gaps").insert(
        missing.map((candidate) => ({
          run_id: run.id,
          tenant_id: tenantId,
          page_id: candidate.pageId,
          form_id: candidate.formId,
          form_name: candidate.formName,
          leadgen_id: candidate.leadgenId,
          lead_created_time: candidate.createdTime,
          ad_id: candidate.adId,
          status: "missing" as const,
        })),
      );
      if (gapsError) throw new Error(`reconciliation_gaps_insert_failed: ${gapsError.message}`);
    }

    const { data: finished } = await sb
      .from("meta_lead_reconciliation_runs")
      .update({
        status: partial ? "partial" : "completed",
        pages_checked: pagesChecked,
        forms_checked: formsChecked,
        meta_total: metaTotal,
        local_total: known.size,
        missing_total: missing.length,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select("*")
      .maybeSingle();

    await appendOperationalAuditEvent({
      tenantId,
      actorType: "customer",
      actorId: startedBy,
      module: "leads.central",
      action: "reconciliation.completed",
      resourceType: "meta_lead_reconciliation_runs",
      resourceId: run.id,
      status: "completed",
      severity: missing.length > 0 ? "warning" : "info",
      integration: "meta_lead_ads",
      metadata: {
        pages: pagesChecked,
        forms: formsChecked,
        meta_total: metaTotal,
        missing: missing.length,
        partial,
      },
    });

    return {
      run: (finished as unknown as ReconciliationRunRow) ?? run,
      gaps: await loadReconciliationGaps(sb, tenantId, run.id),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await sb
      .from("meta_lead_reconciliation_runs")
      .update({
        status: "failed",
        error_code: message.split(":")[0]?.slice(0, 80) ?? "failed",
        error_message: message.slice(0, 300),
        pages_checked: pagesChecked,
        forms_checked: formsChecked,
        meta_total: metaTotal,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw error;
  }
}

export async function loadReconciliationGaps(
  sb: SupabaseServiceClient,
  tenantId: string,
  runId: string,
  limit = 500,
): Promise<ReconciliationGapRow[]> {
  const { data, error } = await sb
    .from("meta_lead_reconciliation_gaps")
    .select("id, run_id, page_id, form_id, form_name, leadgen_id, lead_created_time, ad_id, status, import_error")
    .eq("tenant_id", tenantId)
    .eq("run_id", runId)
    .order("lead_created_time", { ascending: false })
    .limit(limit);
  if (error) {
    if (isReconciliationSchemaMissing(error)) return [];
    throw new Error(`reconciliation_gaps_query_failed: ${error.message}`);
  }
  return (data ?? []) as unknown as ReconciliationGapRow[];
}

export async function loadLatestReconciliationRun(
  sb: SupabaseServiceClient,
  tenantId: string,
): Promise<ReconciliationRunRow | null> {
  const { data, error } = await sb
    .from("meta_lead_reconciliation_runs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isReconciliationSchemaMissing(error)) return null;
    throw new Error(`reconciliation_run_query_failed: ${error.message}`);
  }
  return (data as unknown as ReconciliationRunRow) ?? null;
}

export type BackfillResult = {
  imported: number;
  failed: number;
  skipped: number;
};

/**
 * Importa os leads em falta pelo mesmo caminho do webhook — mesma resolução de
 * regra, equipe, dono e atribuição de campanha — mas, por omissão, sem acionar
 * o primeiro contato. Reenviar mensagem para um lead de três dias atrás é pior
 * do que não a enviar, e um backfill de 200 leads abriria 200 conversas.
 */
export async function backfillReconciliationGaps(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  runId: string;
  gapIds?: string[];
  withOutreach?: boolean;
  actorId: string;
  maxItems?: number;
}): Promise<BackfillResult> {
  const { sb, tenantId, runId, gapIds, withOutreach, actorId } = params;
  const maxItems = Math.min(500, Math.max(1, params.maxItems ?? 200));

  let query = sb
    .from("meta_lead_reconciliation_gaps")
    .select("id, page_id, form_id, leadgen_id, lead_created_time, ad_id, status")
    .eq("tenant_id", tenantId)
    .eq("run_id", runId)
    .eq("status", "missing");
  if (gapIds?.length) query = query.in("id", gapIds.slice(0, maxItems));

  const { data, error } = await query.limit(maxItems);
  if (error) {
    if (isReconciliationSchemaMissing(error)) throw new Error("reconciliation_schema_pending");
    throw new Error(`reconciliation_backfill_query_failed: ${error.message}`);
  }

  const gaps = (data ?? []) as Array<{
    id: string;
    page_id: string;
    form_id: string | null;
    leadgen_id: string;
    lead_created_time: string | null;
    ad_id: string | null;
  }>;

  let imported = 0;
  let failed = 0;

  for (const gap of gaps) {
    try {
      await processMetaLeadgenEvent(
        {
          leadgen_id: gap.leadgen_id,
          page_id: gap.page_id,
          form_id: gap.form_id ?? undefined,
          ad_id: gap.ad_id ?? undefined,
          created_time: gap.lead_created_time
            ? Math.floor(new Date(gap.lead_created_time).getTime() / 1000)
            : undefined,
        },
        { suppressOutreach: !withOutreach, reprocessSource: "reconciliation_backfill" },
      );
      imported += 1;
      await sb
        .from("meta_lead_reconciliation_gaps")
        .update({ status: "imported", imported_at: new Date().toISOString(), import_error: null })
        .eq("id", gap.id);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message.slice(0, 200) : "erro";
      await sb
        .from("meta_lead_reconciliation_gaps")
        .update({ status: "import_failed", import_error: message })
        .eq("id", gap.id);
      console.warn("[meta-reconciliation] backfill_failed", {
        tenant_id: tenantId,
        leadgen_id: gap.leadgen_id,
        message,
      });
    }
  }

  if (imported > 0) {
    // Contador informativo: `meta_lead_reconciliation_gaps.status` é a fonte da
    // verdade do que foi importado, então uma corrida aqui não perde dado.
    const { data: current } = await sb
      .from("meta_lead_reconciliation_runs")
      .select("imported_total")
      .eq("id", runId)
      .maybeSingle();
    const total = Number((current as { imported_total?: number } | null)?.imported_total ?? 0);
    await sb
      .from("meta_lead_reconciliation_runs")
      .update({ imported_total: total + imported, updated_at: new Date().toISOString() })
      .eq("id", runId);
  }

  await appendOperationalAuditEvent({
    tenantId,
    actorType: "customer",
    actorId,
    module: "leads.central",
    action: "reconciliation.backfill",
    resourceType: "meta_lead_reconciliation_runs",
    resourceId: runId,
    status: failed > 0 ? "error" : "completed",
    severity: failed > 0 ? "warning" : "info",
    integration: "meta_lead_ads",
    metadata: { imported, failed, with_outreach: Boolean(withOutreach) },
  });

  return { imported, failed, skipped: Math.max(0, gaps.length - imported - failed) };
}
