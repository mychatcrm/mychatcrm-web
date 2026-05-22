import { createHmac } from "crypto";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { processMetaLeadgenEvent } from "@/lib/server/meta-lead-ingest";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type MetaConnectionRow = {
  tenant_id: string;
  page_id: string;
  page_access_token: string;
};

type LeadDistributionRuleRow = {
  use_all_forms: boolean | null;
  included_form_ids: unknown;
  excluded_form_ids: unknown;
};

type MetaFormMappingRow = {
  form_id: string;
};

type GraphLeadRef = {
  id?: string;
  created_time?: string;
  ad_id?: string;
};

type GraphLeadForm = {
  id?: string;
  name?: string;
  leads?: {
    data?: GraphLeadRef[];
  };
};

type PollerConnectionResult = {
  tenantId: string;
  pageId: string;
  formsSeen: number;
  leadsSeen: number;
  forwarded: number;
  skipped: number;
  errors: number;
};

export type MetaLeadPollerResult = {
  ok: boolean;
  connections: number;
  formsSeen: number;
  leadsSeen: number;
  forwarded: number;
  skipped: number;
  errors: number;
  details: PollerConnectionResult[];
};

const DEFAULT_POLL_WINDOW_MINUTES = 120;
const MAX_GRAPH_FORM_PAGES = 10;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function metaLeadCreatedAtMs(createdTime: string | undefined): number | null {
  if (!createdTime) return null;
  const ms = Date.parse(createdTime);
  return Number.isFinite(ms) ? ms : null;
}

export function isRecentMetaLead(createdTime: string | undefined, nowMs: number, windowMinutes: number): boolean {
  const createdAtMs = metaLeadCreatedAtMs(createdTime);
  if (!createdAtMs) return false;
  return createdAtMs >= nowMs - windowMinutes * 60_000 && createdAtMs <= nowMs + 60_000;
}

export function buildSignedMetaWebhookHeaders(rawBody: string, appSecret: string): Record<string, string> {
  const digest = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return {
    "content-type": "application/json",
    "x-hub-signature-256": `sha256=${digest}`,
  };
}

function getPollWindowMinutes(): number {
  const raw = Number(process.env.META_LEAD_POLL_WINDOW_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 24 * 60) : DEFAULT_POLL_WINDOW_MINUTES;
}

function shouldIncludeForm(params: {
  formId: string;
  rules: LeadDistributionRuleRow[];
  mappings: MetaFormMappingRow[];
}): boolean {
  const mappingFormIds = new Set(params.mappings.map((row) => row.form_id).filter(Boolean));
  if (mappingFormIds.has(params.formId)) return true;

  for (const rule of params.rules) {
    const excluded = new Set(asStringArray(rule.excluded_form_ids));
    if (excluded.has(params.formId)) continue;
    if (rule.use_all_forms) return true;
    const included = new Set(asStringArray(rule.included_form_ids));
    if (included.has(params.formId)) return true;
  }

  return false;
}

async function fetchGraphLeadFormsWithRecentLeads(pageId: string, pageAccessToken: string): Promise<GraphLeadForm[]> {
  const fields = "id,name,leads.limit(5){id,created_time,ad_id}";
  let url =
    `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/leadgen_forms` +
    `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageAccessToken)}`;
  const forms: GraphLeadForm[] = [];

  for (let page = 0; page < MAX_GRAPH_FORM_PAGES && url; page += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`graph_leadgen_forms_failed status=${res.status} body=${body.slice(0, 180)}`);
    }
    const json = (await res.json()) as {
      data?: GraphLeadForm[];
      paging?: { next?: string };
    };
    forms.push(...(json.data ?? []));
    url = json.paging?.next ?? "";
  }

  return forms;
}

async function ingestLeadFromPoller(params: {
  pageId: string;
  formId: string;
  lead: GraphLeadRef;
}): Promise<boolean> {
  const leadgenId = params.lead.id?.trim();
  if (!leadgenId) return false;
  const createdAtMs = metaLeadCreatedAtMs(params.lead.created_time);
  try {
    await processMetaLeadgenEvent({
      form_id: params.formId,
      leadgen_id: leadgenId,
      page_id: params.pageId,
      ad_id: params.lead.ad_id ?? undefined,
      created_time: createdAtMs ? Math.floor(createdAtMs / 1000) : undefined,
    });
    return true;
  } catch (err) {
    console.warn("[meta-lead-poller] ingest_failed", {
      page_id: params.pageId,
      form_id: params.formId,
      leadgen_id: leadgenId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function processConnection(params: {
  sb: SupabaseServiceClient;
  connection: MetaConnectionRow;
  nowMs: number;
  windowMinutes: number;
}): Promise<PollerConnectionResult> {
  const result: PollerConnectionResult = {
    tenantId: params.connection.tenant_id,
    pageId: params.connection.page_id,
    formsSeen: 0,
    leadsSeen: 0,
    forwarded: 0,
    skipped: 0,
    errors: 0,
  };

  const [rulesRes, mappingsRes] = await Promise.all([
    params.sb
      .from("lead_distribution_rules")
      .select("use_all_forms, included_form_ids, excluded_form_ids")
      .eq("tenant_id", params.connection.tenant_id)
      .eq("page_id", params.connection.page_id)
      .eq("source", "meta_form")
      .eq("active", true)
      .returns<LeadDistributionRuleRow[]>(),
    params.sb
      .from("meta_form_agent_mapping")
      .select("form_id")
      .eq("tenant_id", params.connection.tenant_id)
      .eq("page_id", params.connection.page_id)
      .returns<MetaFormMappingRow[]>(),
  ]);

  if (rulesRes.error) {
    throw new Error(`rules_query_failed: ${rulesRes.error.message}`);
  }
  if (mappingsRes.error) {
    throw new Error(`mappings_query_failed: ${mappingsRes.error.message}`);
  }

  const rules = rulesRes.data ?? [];
  const mappings = mappingsRes.data ?? [];
  if (rules.length === 0 && mappings.length === 0) {
    result.skipped += 1;
    return result;
  }

  const forms = await fetchGraphLeadFormsWithRecentLeads(params.connection.page_id, params.connection.page_access_token);
  result.formsSeen = forms.length;

  for (const form of forms) {
    const formId = form.id?.trim();
    if (!formId || !shouldIncludeForm({ formId, rules, mappings })) continue;

    for (const lead of form.leads?.data ?? []) {
      result.leadsSeen += 1;
      if (!lead.id || !isRecentMetaLead(lead.created_time, params.nowMs, params.windowMinutes)) {
        result.skipped += 1;
        continue;
      }

      const ok = await ingestLeadFromPoller({
        pageId: params.connection.page_id,
        formId,
        lead,
      });
      if (ok) {
        result.forwarded += 1;
      } else {
        result.errors += 1;
      }
    }
  }

  return result;
}

export async function processRecentMetaLeadAds(params: {
  sb: SupabaseServiceClient;
  now?: Date;
}): Promise<MetaLeadPollerResult> {
  const { data: connections, error } = await params.sb
    .from("meta_connections")
    .select("tenant_id, page_id, page_access_token")
    .not("page_access_token", "is", null)
    .returns<MetaConnectionRow[]>();
  if (error) {
    throw new Error(`meta_connections_query_failed: ${error.message}`);
  }

  const seen = new Set<string>();
  const uniqueConnections = (connections ?? []).filter((conn) => {
    const key = `${conn.tenant_id}:${conn.page_id}`;
    if (!conn.tenant_id || !conn.page_id || !conn.page_access_token || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const details: PollerConnectionResult[] = [];
  const nowMs = (params.now ?? new Date()).getTime();
  const windowMinutes = getPollWindowMinutes();

  for (const connection of uniqueConnections) {
    try {
      const detail = await processConnection({
        sb: params.sb,
        connection,
        nowMs,
        windowMinutes,
      });
      details.push(detail);
      console.info("[meta-lead-poller] connection_processed", {
        tenant_id: detail.tenantId,
        page_id: detail.pageId,
        forms_seen: detail.formsSeen,
        leads_seen: detail.leadsSeen,
        forwarded: detail.forwarded,
        skipped: detail.skipped,
        errors: detail.errors,
      });
    } catch (err) {
      details.push({
        tenantId: connection.tenant_id,
        pageId: connection.page_id,
        formsSeen: 0,
        leadsSeen: 0,
        forwarded: 0,
        skipped: 0,
        errors: 1,
      });
      console.error("[meta-lead-poller] connection_failed", {
        tenant_id: connection.tenant_id,
        page_id: connection.page_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    connections: uniqueConnections.length,
    formsSeen: details.reduce((sum, row) => sum + row.formsSeen, 0),
    leadsSeen: details.reduce((sum, row) => sum + row.leadsSeen, 0),
    forwarded: details.reduce((sum, row) => sum + row.forwarded, 0),
    skipped: details.reduce((sum, row) => sum + row.skipped, 0),
    errors: details.reduce((sum, row) => sum + row.errors, 0),
    details,
  };
}
