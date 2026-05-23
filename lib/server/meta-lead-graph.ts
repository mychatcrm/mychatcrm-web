import { buildMetaInitialOutreachUserPrompt } from "@/lib/meta-leads/form-metadata";

export type GraphLeadFieldData = {
  name: string;
  values: string[];
};

export type LeadFormFieldEntry = { key: string; label: string; value: string };

export type MetaAdContext = {
  adName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
};

export function humanizeFieldKeyAsLabel(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return key;
  if (/[A-Za-zÀ-ÿ]/.test(trimmed) && trimmed.includes(" ")) return trimmed;
  return trimmed
    .replace(/_/g, " ")
    .replace(/\?/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/u, (c) => c.toUpperCase());
}

export function buildFormFieldsFromFieldData(
  fieldData: GraphLeadFieldData[],
  questionLabels: Map<string, string>,
): LeadFormFieldEntry[] {
  const rows: LeadFormFieldEntry[] = [];
  for (const f of fieldData) {
    const key = f.name?.trim();
    if (!key || !Array.isArray(f.values) || f.values.length === 0) continue;
    const value = f.values.map((v) => String(v).trim()).filter(Boolean).join(", ");
    if (!value) continue;
    rows.push({
      key,
      label: questionLabels.get(key) ?? humanizeFieldKeyAsLabel(key),
      value,
    });
  }
  return rows;
}

export function buildLeadProfileMetadata(params: {
  leadgenId: string;
  fieldData: GraphLeadFieldData[];
  formId?: string;
  formName: string | null;
  adId?: string;
  adsetId?: string;
  pageId: string;
  pageName: string | null;
  campaignId?: string;
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
  agentResolutionSource?: string | null;
  invalidAgentId?: string | null;
  rawWebhook?: Record<string, unknown>;
  questionLabels: Map<string, string>;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    source: "lead_ads",
    meta_leadgen_id: params.leadgenId,
    form_fields: buildFormFieldsFromFieldData(params.fieldData, params.questionLabels),
  };
  if (params.formId) meta.meta_form_id = params.formId;
  if (params.formName) meta.meta_form_name = params.formName;
  if (params.adId) meta.meta_ad_id = params.adId;
  if (params.adsetId) meta.meta_adset_id = params.adsetId;
  if (params.adsetName) meta.meta_adset_name = params.adsetName;
  if (params.adName) meta.meta_ad_name = params.adName;
  if (params.pageId) meta.meta_page_id = params.pageId;
  if (params.pageName) meta.meta_page_name = params.pageName;
  if (params.campaignId) meta.meta_campaign_id = params.campaignId;
  if (params.campaignName) meta.meta_campaign_name = params.campaignName;
  if (params.agentResolutionSource) meta.meta_agent_resolution_source = params.agentResolutionSource;
  if (params.invalidAgentId) meta.meta_agent_resolution_invalid_id = params.invalidAgentId;
  if (params.rawWebhook) meta.meta_raw_webhook = params.rawWebhook;
  return meta;
}

export type MetaFormSubmissionEntry = {
  leadgen_id: string;
  form_id?: string;
  form_name?: string;
  form_fields: LeadFormFieldEntry[];
  received_at: string;
};

export function mergeLeadProfileMetadata(
  previous: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const prev =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...prev, ...next };

  const history: MetaFormSubmissionEntry[] = Array.isArray(prev.meta_form_submissions)
    ? (prev.meta_form_submissions as MetaFormSubmissionEntry[]).filter(
        (row) => row && typeof row === "object" && typeof row.leadgen_id === "string",
      )
    : [];

  const prevLeadgenId = typeof prev.meta_leadgen_id === "string" ? prev.meta_leadgen_id.trim() : "";
  const prevFields = Array.isArray(prev.form_fields) ? (prev.form_fields as LeadFormFieldEntry[]) : [];
  if (prevLeadgenId && prevFields.length > 0 && !history.some((row) => row.leadgen_id === prevLeadgenId)) {
    history.push({
      leadgen_id: prevLeadgenId,
      form_id: typeof prev.meta_form_id === "string" ? prev.meta_form_id : undefined,
      form_name: typeof prev.meta_form_name === "string" ? prev.meta_form_name : undefined,
      form_fields: prevFields,
      received_at: typeof prev.meta_initial_outreach_sent_at === "string" ? prev.meta_initial_outreach_sent_at : "",
    });
  }

  const leadgenId = typeof next.meta_leadgen_id === "string" ? next.meta_leadgen_id.trim() : "";
  const formFields = Array.isArray(next.form_fields) ? (next.form_fields as LeadFormFieldEntry[]) : [];
  if (leadgenId && formFields.length > 0) {
    const withoutDup = history.filter((row) => row.leadgen_id !== leadgenId);
    withoutDup.push({
      leadgen_id: leadgenId,
      form_id: typeof next.meta_form_id === "string" ? next.meta_form_id : undefined,
      form_name: typeof next.meta_form_name === "string" ? next.meta_form_name : undefined,
      form_fields: formFields,
      received_at: new Date().toISOString(),
    });
    merged.meta_form_submissions = withoutDup;
  } else if (history.length > 0) {
    merged.meta_form_submissions = history;
  }

  return merged;
}

export function buildMetaInitialAgentPrompt(params: {
  leadName: string;
  phone: string;
  email: string | null;
  formName: string | null;
  pageName: string | null;
  campaignName: string | null;
  adName: string | null;
  adsetName?: string | null;
  formFields: unknown;
  profileMetadata?: Record<string, unknown>;
}): string {
  const profileMetadata: Record<string, unknown> = {
    ...(params.profileMetadata ?? {}),
    source: "lead_ads",
    meta_form_name: params.formName ?? params.profileMetadata?.meta_form_name,
    meta_page_name: params.pageName ?? params.profileMetadata?.meta_page_name,
    meta_campaign_name: params.campaignName ?? params.profileMetadata?.meta_campaign_name,
    meta_adset_name: params.adsetName ?? params.profileMetadata?.meta_adset_name,
    meta_ad_name: params.adName ?? params.profileMetadata?.meta_ad_name,
    form_fields: params.formFields ?? params.profileMetadata?.form_fields,
  };
  return buildMetaInitialOutreachUserPrompt({
    leadName: params.leadName,
    phone: params.phone,
    email: params.email,
    profileMetadata,
  });
}

export function buildFallbackInitialMessage(fullName: string): string {
  const firstName = fullName.split(/\s+/)[0] || "tudo bem";
  return `Olá, ${firstName}! Recebi seu cadastro e já vou te ajudar por aqui.`;
}

export function sanitizeInitialReply(text: string): string {
  return text
    .replace(/\[\[HANDOFF\]\]/gi, "")
    .replace(/\[\[ENVIAR_MEDIA:[^\]]+\]\]/gi, "")
    .trim();
}

export async function fetchGraphObjectField(
  objectId: string,
  field: string,
  pageAccessToken: string,
): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(objectId)}?fields=${encodeURIComponent(field)}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const value = data[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function fetchGraphAdContext(adId: string, pageAccessToken: string): Promise<MetaAdContext> {
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(adId)}?fields=name,campaign{id,name},adset{id,name}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return emptyAdContext();
    const data = (await res.json()) as {
      name?: string;
      campaign?: { id?: string; name?: string };
      adset?: { id?: string; name?: string };
    };
    return {
      adName: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
      campaignId: typeof data.campaign?.id === "string" && data.campaign.id.trim() ? data.campaign.id.trim() : null,
      campaignName:
        typeof data.campaign?.name === "string" && data.campaign.name.trim() ? data.campaign.name.trim() : null,
      adsetId: typeof data.adset?.id === "string" && data.adset.id.trim() ? data.adset.id.trim() : null,
      adsetName: typeof data.adset?.name === "string" && data.adset.name.trim() ? data.adset.name.trim() : null,
    };
  } catch {
    return emptyAdContext();
  }
}

function emptyAdContext(): MetaAdContext {
  return {
    adName: null,
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adsetName: null,
  };
}

export async function fetchFormQuestionLabels(formId: string, pageAccessToken: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(formId)}?fields=questions{key,label}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return labels;
    const raw = (await res.json()) as {
      questions?: Array<{ key?: string; label?: string }> | { data?: Array<{ key?: string; label?: string }> };
    };
    const list = Array.isArray(raw.questions)
      ? raw.questions
      : Array.isArray(raw.questions?.data)
        ? raw.questions.data
        : [];
    for (const q of list) {
      const key = q.key?.trim();
      const label = q.label?.trim();
      if (key && label) labels.set(key, label);
    }
  } catch {
    return labels;
  }
  return labels;
}

export type GraphLeadResponse = {
  id: string;
  created_time?: string;
  field_data?: GraphLeadFieldData[];
};

export async function fetchGraphLead(leadgenId: string, pageAccessToken: string): Promise<GraphLeadResponse | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?fields=field_data,created_time&access_token=${encodeURIComponent(pageAccessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[meta-webhook] Graph API error", { status: res.status, body: body.slice(0, 300) });
      return null;
    }
    return (await res.json()) as GraphLeadResponse;
  } catch (err) {
    console.warn("[meta-webhook] fetchGraphLead failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function parseFieldData(fieldData: GraphLeadFieldData[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData) {
    if (f.name && Array.isArray(f.values) && f.values.length > 0) {
      out[f.name.toLowerCase().replace(/\s+/g, "_")] = f.values[0] ?? "";
    }
  }
  return out;
}
