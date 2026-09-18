import "server-only";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { bucketMetaLeadEventStep } from "@/lib/meta-lead-event-status";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Detecção de anomalias nos leads pagos.
 *
 * Quem gasta em anúncio costuma descobrir tarde que algo parou — o formulário
 * quebrou, a campanha perdeu entrega, a conexão caiu. A comparação é sempre
 * contra o período anterior de mesmo tamanho: nenhum limiar fixo serve a um
 * cliente de 50 leads/mês e a outro de 15 mil.
 */

export type AlertKind = "volume_drop" | "form_silent" | "error_spike" | "no_agent_spike";

export type DetectedAlert = {
  kind: AlertKind;
  severity: "info" | "warning" | "critical";
  scopeType: "campaign" | "form" | "page" | "tenant";
  scopeId: string | null;
  scopeName: string | null;
  title: string;
  detail: string;
  metrics: Record<string, number>;
  fingerprint: string;
};

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const SCAN_LIMIT = 10_000;

/** Abaixo disto a variação é ruído: 2 leads que viram 1 não são uma queda. */
const MIN_BASELINE_LEADS = 8;
const VOLUME_DROP_RATIO = 0.5;
const ERROR_RATE_THRESHOLD = 0.3;

type EventRow = {
  campaign_id: string | null;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  current_step: string;
  crm_sync_status: string;
  created_at: string;
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildFingerprint(kind: AlertKind, scopeId: string | null, windowKey: string): string {
  return `${kind}:${scopeId ?? "tenant"}:${windowKey}`;
}

/**
 * Compara a janela recente com a anterior de mesmo tamanho e devolve o que
 * merece um aviso. Função pura sobre as linhas — o que a torna testável sem
 * banco e sem relógio.
 */
export function detectAlertsFromEvents(params: {
  events: EventRow[];
  now: Date;
  windowHours: number;
}): DetectedAlert[] {
  const { events, now, windowHours } = params;
  const windowMs = windowHours * 60 * 60 * 1000;
  const recentStart = now.getTime() - windowMs;
  const baselineStart = recentStart - windowMs;
  const windowKey = dayKey(now);

  type Bucket = { total: number; errors: number; noAgent: number; name: string | null };
  const makeBucket = (): Bucket => ({ total: 0, errors: 0, noAgent: 0, name: null });

  const recentByCampaign = new Map<string, Bucket>();
  const baselineByCampaign = new Map<string, Bucket>();
  const recentByForm = new Map<string, Bucket>();
  const baselineByForm = new Map<string, Bucket>();
  const tenantRecent = makeBucket();

  for (const event of events) {
    const at = new Date(event.created_at).getTime();
    if (!Number.isFinite(at) || at < baselineStart) continue;
    const isRecent = at >= recentStart;

    const campaignId = event.campaign_id;
    const formId = event.form_id;
    const bucketIsError = bucketMetaLeadEventStep(event.current_step) === "erro";
    const noAgent = event.current_step === "skipped_no_agent";

    const apply = (map: Map<string, Bucket>, key: string | null, name: string | null) => {
      if (!key) return;
      const bucket = map.get(key) ?? makeBucket();
      bucket.total += 1;
      if (bucketIsError) bucket.errors += 1;
      if (noAgent) bucket.noAgent += 1;
      if (name && !bucket.name) bucket.name = name;
      map.set(key, bucket);
    };

    apply(isRecent ? recentByCampaign : baselineByCampaign, campaignId, event.campaign_name);
    apply(isRecent ? recentByForm : baselineByForm, formId, event.form_name);

    if (isRecent) {
      tenantRecent.total += 1;
      if (bucketIsError) tenantRecent.errors += 1;
      if (noAgent) tenantRecent.noAgent += 1;
    }
  }

  const alerts: DetectedAlert[] = [];

  for (const [campaignId, baseline] of baselineByCampaign) {
    if (baseline.total < MIN_BASELINE_LEADS) continue;
    const recent = recentByCampaign.get(campaignId)?.total ?? 0;
    const ratio = recent / baseline.total;
    if (ratio > VOLUME_DROP_RATIO) continue;

    const name = recentByCampaign.get(campaignId)?.name ?? baseline.name ?? campaignId;
    const drop = Math.round((1 - ratio) * 100);
    alerts.push({
      kind: "volume_drop",
      severity: recent === 0 ? "critical" : "warning",
      scopeType: "campaign",
      scopeId: campaignId,
      scopeName: name,
      title:
        recent === 0
          ? `A campanha "${name}" parou de trazer leads`
          : `A campanha "${name}" caiu ${drop}% em leads`,
      detail:
        recent === 0
          ? `Nas últimas ${windowHours} h não entrou nenhum lead. No período anterior foram ${baseline.total}.`
          : `Nas últimas ${windowHours} h entraram ${recent} leads, contra ${baseline.total} no período anterior.`,
      metrics: { recent, baseline: baseline.total, drop_percent: drop },
      fingerprint: buildFingerprint("volume_drop", campaignId, windowKey),
    });
  }

  for (const [formId, baseline] of baselineByForm) {
    if (baseline.total < MIN_BASELINE_LEADS) continue;
    if ((recentByFormTotal(recentByForm, formId)) > 0) continue;
    const name = baseline.name ?? formId;
    alerts.push({
      kind: "form_silent",
      severity: "critical",
      scopeType: "form",
      scopeId: formId,
      scopeName: name,
      title: `O formulário "${name}" parou`,
      detail: `Nenhum lead nas últimas ${windowHours} h, contra ${baseline.total} no período anterior. Vale conferir a conexão da página e a regra de distribuição.`,
      metrics: { recent: 0, baseline: baseline.total },
      fingerprint: buildFingerprint("form_silent", formId, windowKey),
    });
  }

  if (tenantRecent.total >= MIN_BASELINE_LEADS) {
    const errorRate = tenantRecent.errors / tenantRecent.total;
    if (errorRate >= ERROR_RATE_THRESHOLD) {
      alerts.push({
        kind: "error_spike",
        severity: errorRate >= 0.6 ? "critical" : "warning",
        scopeType: "tenant",
        scopeId: null,
        scopeName: null,
        title: `${Math.round(errorRate * 100)}% dos leads entraram com erro`,
        detail: `Nas últimas ${windowHours} h, ${tenantRecent.errors} de ${tenantRecent.total} leads não completaram o fluxo. Veja a coluna Estado na Central para o motivo.`,
        metrics: { recent: tenantRecent.total, errors: tenantRecent.errors },
        fingerprint: buildFingerprint("error_spike", null, windowKey),
      });
    }

    const noAgentRate = tenantRecent.noAgent / tenantRecent.total;
    if (noAgentRate >= ERROR_RATE_THRESHOLD) {
      alerts.push({
        kind: "no_agent_spike",
        severity: "warning",
        scopeType: "tenant",
        scopeId: null,
        scopeName: null,
        title: `${Math.round(noAgentRate * 100)}% dos leads ficaram sem agente`,
        detail: `${tenantRecent.noAgent} de ${tenantRecent.total} leads chegaram sem agente autorizado. Confira as regras em Integrações → Leads.`,
        metrics: { recent: tenantRecent.total, no_agent: tenantRecent.noAgent },
        fingerprint: buildFingerprint("no_agent_spike", null, windowKey),
      });
    }
  }

  return alerts;
}

function recentByFormTotal(map: Map<string, { total: number }>, formId: string): number {
  return map.get(formId)?.total ?? 0;
}

export async function detectAndStoreMetaLeadAlerts(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  windowHours?: number;
  now?: Date;
}): Promise<DetectedAlert[]> {
  const { sb, tenantId } = params;
  const windowHours = Math.min(168, Math.max(1, params.windowHours ?? 24));
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - windowHours * 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("meta_lead_events")
    .select("campaign_id, campaign_name, form_id, form_name, current_step, crm_sync_status, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code ?? "")) return [];
    throw new Error(`meta_lead_alerts_scan_failed: ${error.message}`);
  }

  const alerts = detectAlertsFromEvents({
    events: (data ?? []) as unknown as EventRow[],
    now,
    windowHours,
  });
  if (alerts.length === 0) return [];

  const { error: insertError } = await sb.from("meta_lead_alerts").upsert(
    alerts.map((alert) => ({
      tenant_id: tenantId,
      kind: alert.kind,
      severity: alert.severity,
      scope_type: alert.scopeType,
      scope_id: alert.scopeId,
      scope_name: alert.scopeName,
      title: alert.title,
      detail: alert.detail,
      metrics: alert.metrics,
      fingerprint: alert.fingerprint,
      detected_at: now.toISOString(),
    })),
    { onConflict: "tenant_id,fingerprint", ignoreDuplicates: true },
  );

  if (insertError && !MISSING_TABLE_CODES.has(insertError.code ?? "")) {
    console.warn("[meta-lead-alerts] store_failed", { tenant_id: tenantId, error: insertError.message });
  }

  return alerts;
}

export type StoredAlert = DetectedAlert & {
  id: string;
  status: "open" | "acknowledged" | "resolved";
  detectedAt: string;
};

export async function loadOpenMetaLeadAlerts(
  sb: SupabaseServiceClient,
  tenantId: string,
  limit = 20,
): Promise<StoredAlert[]> {
  const { data, error } = await sb
    .from("meta_lead_alerts")
    .select("id, kind, severity, scope_type, scope_id, scope_name, title, detail, metrics, fingerprint, status, detected_at")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code ?? "")) return [];
    throw new Error(`meta_lead_alerts_query_failed: ${error.message}`);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    kind: row.kind as AlertKind,
    severity: row.severity as DetectedAlert["severity"],
    scopeType: row.scope_type as DetectedAlert["scopeType"],
    scopeId: (row.scope_id as string | null) ?? null,
    scopeName: (row.scope_name as string | null) ?? null,
    title: String(row.title),
    detail: String(row.detail),
    metrics: (row.metrics as Record<string, number>) ?? {},
    fingerprint: String(row.fingerprint),
    status: row.status as StoredAlert["status"],
    detectedAt: String(row.detected_at),
  }));
}

export async function acknowledgeMetaLeadAlert(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  alertId: string;
  actorId: string;
}): Promise<boolean> {
  const { error } = await params.sb
    .from("meta_lead_alerts")
    .update({
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: params.actorId.slice(0, 120),
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.alertId);
  return !error;
}
