import "server-only";

import { createHash } from "node:crypto";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { metaGraphErrorCode, metaGraphRequest } from "@/lib/server/meta-graph-api";
import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";
import { classifyColumn } from "@/lib/server/meta-lead-outcome";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Conversions API para Leads — o retorno do ciclo.
 *
 * A Meta entrega o lead; sem resposta, ela só sabe otimizar para "quem
 * preenche formulário". Devolvendo "este lead agendou" e "este lead comprou", a
 * campanha do cliente passa a perseguir resultado, não volume.
 *
 * Para leads de formulário a Meta identifica a pessoa pelo próprio
 * `leadgen_id` (`user_data.lead_id`), então **nenhum dado pessoal sai daqui** —
 * nem telefone, nem e-mail, nem nome. É mais privado e mais preciso do que
 * casar por hash de contato.
 */

export const CAPI_EVENT_NAMES = ["Lead", "Qualified", "Schedule", "Purchase", "Contact"] as const;
export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const GRAPH_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 60_000;

export function isCapiSchemaMissing(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

/** Coluna do CRM → evento que faz sentido para a Meta. Nem toda mudança vira conversão. */
export function eventNameForColumn(columnId: string | null): CapiEventName | null {
  const outcome = classifyColumn(columnId);
  if (outcome === "won") return "Purchase";
  const id = columnId?.trim().toLowerCase() ?? "";
  if (/(proposta|negocia|qualific)/.test(id)) return "Qualified";
  return null;
}

type RuleConversionConfig = {
  ruleId: string;
  pixelId: string;
  accessToken: string;
};

/**
 * Configuração de conversão da regra que admitiu o lead. Sem envio ligado,
 * sem pixel ou sem token, não há o que enfileirar.
 */
async function loadConversionConfig(
  sb: SupabaseServiceClient,
  tenantId: string,
  ruleId: string | null,
): Promise<RuleConversionConfig | null> {
  if (!ruleId) return null;
  const { data, error } = await sb
    .from("lead_distribution_rules")
    .select("id, conversion_send_enabled, conversion_pixel_id, conversion_api_secret")
    .eq("tenant_id", tenantId)
    .eq("id", ruleId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as {
    id?: unknown;
    conversion_send_enabled?: unknown;
    conversion_pixel_id?: unknown;
    conversion_api_secret?: unknown;
  };
  if (row.conversion_send_enabled !== true) return null;
  const pixelId = typeof row.conversion_pixel_id === "string" ? row.conversion_pixel_id.trim() : "";
  const accessToken = typeof row.conversion_api_secret === "string" ? row.conversion_api_secret.trim() : "";
  if (!pixelId || !accessToken) return null;

  return { ruleId: String(row.id), pixelId, accessToken };
}

export type EnqueueCapiParams = {
  sb: SupabaseServiceClient;
  tenantId: string;
  leadId: string;
  eventName: CapiEventName;
  /** Momento do desfecho, não do envio — a Meta usa isto na atribuição. */
  occurredAt?: Date;
  value?: number | null;
  currency?: string | null;
  sourceNote?: string;
};

export type EnqueueCapiResult =
  | { queued: true; id: string }
  | { queued: false; reason: "no_meta_lead" | "not_configured" | "duplicate" | "schema_pending" | "failed" };

/**
 * Enfileira uma conversão. Nunca lança: a venda do cliente não pode falhar
 * porque a fila de marketing teve um problema.
 */
export async function enqueueMetaCapiEvent(params: EnqueueCapiParams): Promise<EnqueueCapiResult> {
  const { sb, tenantId, leadId, eventName } = params;
  try {
    const { data: leadRow } = await sb
      .from("leads")
      .select("id, profile_metadata, campaign_rule_id, rule_id, source")
      .eq("tenant_id", tenantId)
      .eq("id", leadId)
      .maybeSingle();

    const lead = leadRow as {
      profile_metadata?: Record<string, unknown> | null;
      campaign_rule_id?: string | null;
      rule_id?: string | null;
      source?: string | null;
    } | null;
    if (!lead) return { queued: false, reason: "no_meta_lead" };

    const leadgenId =
      typeof lead.profile_metadata?.meta_leadgen_id === "string"
        ? (lead.profile_metadata.meta_leadgen_id as string)
        : null;
    // Sem leadgen_id não há como a Meta reconhecer a pessoa sem enviar dado
    // pessoal — e enviar dado pessoal para otimizar anúncio não é uma troca
    // que se faça em silêncio pelo cliente.
    if (!leadgenId) return { queued: false, reason: "no_meta_lead" };

    const config = await loadConversionConfig(
      sb,
      tenantId,
      lead.campaign_rule_id ?? lead.rule_id ?? null,
    );
    if (!config) return { queued: false, reason: "not_configured" };

    const occurredAt = params.occurredAt ?? new Date();
    const dedupKey = `${leadgenId}:${eventName}`;

    const { data, error } = await sb
      .from("meta_capi_outbox")
      .insert({
        tenant_id: tenantId,
        lead_id: leadId,
        leadgen_id: leadgenId,
        rule_id: config.ruleId,
        event_name: eventName,
        event_time: occurredAt.toISOString(),
        dedup_key: dedupKey,
        pixel_id: config.pixelId,
        payload: {
          value: params.value ?? null,
          currency: params.currency ?? null,
          source_note: params.sourceNote ?? null,
        },
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if (isCapiSchemaMissing(error)) return { queued: false, reason: "schema_pending" };
      // Índice único: o mesmo desfecho já foi enfileirado antes.
      if (error.code === "23505") return { queued: false, reason: "duplicate" };
      console.warn("[meta-capi] enqueue_failed", { tenant_id: tenantId, error: error.message });
      return { queued: false, reason: "failed" };
    }

    return { queued: true, id: String((data as { id?: unknown })?.id ?? "") };
  } catch (error) {
    console.warn("[meta-capi] enqueue_threw", {
      tenant_id: tenantId,
      error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });
    return { queued: false, reason: "failed" };
  }
}

/** Atalho para o movimento de coluna: decide o evento e enfileira, se houver. */
export async function enqueueCapiForColumnChange(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  leadId: string;
  columnId: string;
  sourceNote?: string;
}): Promise<EnqueueCapiResult | null> {
  const eventName = eventNameForColumn(params.columnId);
  if (!eventName) return null;
  return enqueueMetaCapiEvent({
    sb: params.sb,
    tenantId: params.tenantId,
    leadId: params.leadId,
    eventName,
    sourceNote: params.sourceNote ?? `crm_column:${params.columnId}`,
  });
}

type OutboxRow = {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  leadgen_id: string | null;
  rule_id: string | null;
  event_name: CapiEventName;
  event_time: string;
  pixel_id: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
};

/** Hash exigido pela Meta para qualquer identificador pessoal que venha a ser enviado. */
export function sha256Lower(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export type CapiDeliveryResult = { claimed: number; sent: number; failed: number; skipped: number };

export async function deliverPendingCapiEvents(params: {
  sb: SupabaseServiceClient;
  limit?: number;
}): Promise<CapiDeliveryResult> {
  const { sb } = params;
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const { data, error } = await sb.rpc("claim_meta_capi_events_v1", { p_limit: limit });
  if (error) {
    if (isCapiSchemaMissing(error) || error.code === "42883") {
      return { claimed: 0, sent: 0, failed: 0, skipped: 0 };
    }
    throw new Error(`capi_claim_failed: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as OutboxRow[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const { data: ruleRow } = await sb
      .from("lead_distribution_rules")
      .select("conversion_api_secret, conversion_send_enabled")
      .eq("tenant_id", row.tenant_id)
      .eq("id", row.rule_id ?? "")
      .maybeSingle();

    const rule = ruleRow as {
      conversion_api_secret?: string | null;
      conversion_send_enabled?: boolean | null;
    } | null;

    // O cliente pode ter desligado o envio depois de o evento entrar na fila.
    if (!rule?.conversion_send_enabled || !rule.conversion_api_secret?.trim()) {
      skipped += 1;
      await sb
        .from("meta_capi_outbox")
        .update({
          status: "skipped",
          last_error_code: "conversion_disabled",
          claim_token: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    const payload = row.payload ?? {};
    const customData: Record<string, unknown> = {};
    if (typeof payload.value === "number" && payload.value > 0) {
      customData.value = payload.value;
      customData.currency = typeof payload.currency === "string" ? payload.currency : "BRL";
    }

    try {
      await metaGraphRequest(`/${encodeURIComponent(row.pixel_id)}/events`, {
        accessToken: rule.conversion_api_secret.trim(),
        method: "POST",
        form: {
          data: JSON.stringify([
            {
              event_name: row.event_name,
              event_time: Math.floor(new Date(row.event_time).getTime() / 1000),
              // O desfecho é registado pelo sistema, não por um clique no site.
              action_source: "system_generated",
              event_id: row.id,
              user_data: { lead_id: Number(row.leadgen_id) || row.leadgen_id },
              ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
            },
          ]),
        },
        timeoutMs: GRAPH_TIMEOUT_MS,
      });

      sent += 1;
      await sb
        .from("meta_capi_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          claim_token: null,
          claim_expires_at: null,
          last_error_code: null,
          last_error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      await appendOperationalAuditEvent({
        tenantId: row.tenant_id,
        actorType: "worker",
        module: "leads.central",
        action: "capi.sent",
        resourceType: "meta_capi_outbox",
        resourceId: row.id,
        status: "completed",
        severity: "info",
        integration: "meta_capi",
        metadata: { event_name: row.event_name, attempt: row.attempts },
      });
    } catch (error) {
      failed += 1;
      const code = metaGraphErrorCode(error) ?? "unknown";
      const message = error instanceof Error ? error.message.slice(0, 200) : "erro";
      const exhausted = row.attempts >= row.max_attempts;
      await sb
        .from("meta_capi_outbox")
        .update({
          status: exhausted ? "failed" : "pending",
          // Recuo exponencial: a Meta responde 429 sob carga e insistir piora.
          next_attempt_at: new Date(Date.now() + BACKOFF_BASE_MS * 2 ** row.attempts).toISOString(),
          last_error_code: String(code).slice(0, 80),
          last_error_message: message,
          claim_token: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      console.warn("[meta-capi] delivery_failed", {
        tenant_id: row.tenant_id,
        event_id: row.id,
        code,
        attempt: row.attempts,
      });
    }
  }

  return { claimed: rows.length, sent, failed, skipped };
}
