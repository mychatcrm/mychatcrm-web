import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { attributionToJson, inferAttributionChannel } from "@/lib/landing/attribution";
import { buildSubmissionDedupKey, validateLandingSubmission } from "@/lib/landing/form-schema";
import { loadRuleTeamAssignment } from "@/lib/server/meta-lead-team-assignment";
import type { LandingAttribution } from "@/lib/landing/types";
import type { PublishedLandingPage } from "@/lib/server/landing-pages-db";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const DUPLICATE_KEY_CODES = new Set(["23505"]);

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_COLUMN_CODES.has(error.code));
}

function isDuplicate(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && DUPLICATE_KEY_CODES.has(error.code));
}

/** IP vira hash com sal do ambiente: a auditoria do projeto é PII-free por regra. */
function hashIp(ip: string | null | undefined): string | null {
  const value = String(ip ?? "").trim();
  if (!value) return null;
  const salt = process.env.PASSWORD_PEPPER?.trim() || "mychatcrm-landing";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

export type LandingSubmissionResult =
  | {
      ok: true;
      submissionId: string | null;
      leadId: string | null;
      duplicate: boolean;
      successMessage: string;
    }
  | { ok: false; code: "invalid"; errors: Record<string, string> }
  | { ok: false; code: "unavailable" | "failed"; message: string };

/**
 * Submissão pública → lead no CRM.
 *
 * Ordem deliberada: a submissão é gravada ANTES de qualquer tentativa de criar
 * o lead. Se o CRM falhar, o contacto continua registado e recuperável; o
 * inverso perderia para sempre alguém que a campanha já pagou para trazer.
 *
 * **Não consome cota de leads atendidos.** A cota conta atendimento do agente, e
 * esta fase entrega o lead ao CRM sem primeiro contacto automático — o plano já
 * promete "leads no CRM ilimitados". Quando o primeiro contacto entrar, é aí que
 * a cota passa a valer, pelo caminho que o motor já usa.
 */
export async function recordLandingSubmission(params: {
  published: PublishedLandingPage;
  payload: Record<string, unknown>;
  consentGiven: boolean;
  attribution: LandingAttribution;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
  client?: SupabaseServiceClient;
}): Promise<LandingSubmissionResult> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { page, version } = params.published;
  const now = params.now ?? new Date();

  const formBlock = version.content.blocks.find((block) => block.kind === "form");
  const successMessage =
    formBlock && formBlock.kind === "form"
      ? formBlock.successMessage
      : "Recebemos o seu contacto.";

  const validation = validateLandingSubmission({
    fields: version.content.formFields,
    payload: params.payload,
    consentGiven: params.consentGiven,
  });
  if (!validation.ok) return { ok: false, code: "invalid", errors: validation.errors };

  const dedupKey = buildSubmissionDedupKey({ phoneDigits: validation.phoneDigits, at: now });

  const { data: submissionRow, error: submissionError } = await sb
    .from("landing_page_submissions")
    .insert({
      tenant_id: page.tenantId,
      page_id: page.id,
      version_id: version.id,
      payload: validation.values,
      attribution: attributionToJson(params.attribution),
      dedup_key: dedupKey,
      ip_hash: hashIp(params.ip),
      user_agent: String(params.userAgent ?? "").slice(0, 300) || null,
      lead_status: "pending",
    })
    .select("id")
    .single();

  if (submissionError) {
    if (isMissingTable(submissionError)) {
      return {
        ok: false,
        code: "unavailable",
        message: "Este formulário ainda não está disponível. Tente novamente mais tarde.",
      };
    }
    if (isDuplicate(submissionError)) {
      // Duplo clique ou reenvio: o primeiro já entrou, e dizer "erro" faria a
      // pessoa preencher de novo achando que falhou.
      return { ok: true, submissionId: null, leadId: null, duplicate: true, successMessage };
    }
    console.error("[landing-submission] gravação falhou", submissionError);
    return { ok: false, code: "failed", message: "Não foi possível enviar agora. Tente novamente." };
  }

  const submissionId = String((submissionRow as Record<string, unknown>).id);

  const lead = await upsertLandingLead({
    sb,
    page,
    phoneDigits: validation.phoneDigits,
    name: validation.name,
    email: validation.email,
    attribution: params.attribution,
    now,
  });

  await sb
    .from("landing_page_submissions")
    .update({
      lead_id: lead.leadId,
      lead_status: lead.status,
      lead_error: lead.error,
    })
    .eq("id", submissionId)
    .eq("tenant_id", page.tenantId);

  return { ok: true, submissionId, leadId: lead.leadId, duplicate: false, successMessage };
}

type LeadUpsertOutcome = {
  leadId: string | null;
  status: "created" | "updated" | "failed" | "blocked";
  error: string | null;
};

async function upsertLandingLead(params: {
  sb: SupabaseServiceClient;
  page: PublishedLandingPage["page"];
  phoneDigits: string;
  name: string;
  email: string | null;
  attribution: LandingAttribution;
  now: Date;
}): Promise<LeadUpsertOutcome> {
  const { sb, page } = params;
  const phone = params.phoneDigits;
  const occurredAt = params.now.toISOString();

  // A equipa vem da regra que admitiu o lead. Sem carimbo, o lead nasce órfão e
  // só o titular o vê — some do vendedor que devia atendê-lo.
  const assignment = page.ruleId
    ? await loadRuleTeamAssignment(sb, page.tenantId, page.ruleId).catch(() => null)
    : null;

  const teamId = page.teamId ?? assignment?.teamId ?? null;
  const ownerEmployeeId = assignment?.sellerId ?? null;

  const { data: existing } = await sb
    .from("leads")
    .select("id")
    .eq("tenant_id", page.tenantId)
    .eq("phone", phone)
    .maybeSingle();

  const attributionJson = attributionToJson(params.attribution);
  const channel = inferAttributionChannel(params.attribution);

  if (existing) {
    const leadId = String((existing as Record<string, unknown>).id);
    const patch: Record<string, unknown> = {
      updated_at: occurredAt,
      last_seen: occurredAt,
      ...(params.name ? { name: params.name } : {}),
      ...(params.email ? { email: params.email } : {}),
    };
    const enriched = {
      ...patch,
      attribution: attributionJson,
      landing_page_id: page.id,
    };

    // O `tenant_id` repete-se na condição de propósito: o id veio de uma
    // consulta já recortada, mas escrever sem o recorte deixa a rota a uma
    // refatoração de distância de atualizar lead de outra conta.
    let { error } = await sb
      .from("leads")
      .update(enriched)
      .eq("id", leadId)
      .eq("tenant_id", page.tenantId);
    if (error && isMissingColumn(error)) {
      ({ error } = await sb
        .from("leads")
        .update(patch)
        .eq("id", leadId)
        .eq("tenant_id", page.tenantId));
    }
    if (error) {
      console.error("[landing-submission] atualização do lead falhou", error);
      return { leadId, status: "failed", error: error.message.slice(0, 200) };
    }
    return { leadId, status: "updated", error: null };
  }

  const base: Record<string, unknown> = {
    tenant_id: page.tenantId,
    phone,
    name: params.name || null,
    email: params.email,
    source: `landing_page:${channel}`,
    status: page.columnId || "novo",
    created_at: occurredAt,
    updated_at: occurredAt,
    last_seen: occurredAt,
    ...(page.funnelId ? { crm_funnel_id: page.funnelId } : {}),
    ...(teamId ? { team_id: teamId } : {}),
    ...(ownerEmployeeId ? { owner_employee_id: ownerEmployeeId } : {}),
  };

  const enriched = { ...base, attribution: attributionJson, landing_page_id: page.id };

  let insert = await sb.from("leads").insert(enriched).select("id").single();
  if (insert.error && isMissingColumn(insert.error)) {
    insert = await sb.from("leads").insert(base).select("id").single();
  }

  if (insert.error) {
    if (isDuplicate(insert.error)) {
      const { data: raced } = await sb
        .from("leads")
        .select("id")
        .eq("tenant_id", page.tenantId)
        .eq("phone", phone)
        .maybeSingle();
      const leadId = raced ? String((raced as Record<string, unknown>).id) : null;
      return { leadId, status: leadId ? "updated" : "failed", error: null };
    }
    console.error("[landing-submission] criação do lead falhou", insert.error);
    return { leadId: null, status: "failed", error: insert.error.message.slice(0, 200) };
  }

  const leadId = insert.data ? String((insert.data as Record<string, unknown>).id) : null;
  return { leadId, status: leadId ? "created" : "failed", error: null };
}

export type LandingSubmissionSummary = {
  total: number;
  last7Days: number;
  leadsCreated: number;
  byChannel: Record<string, number>;
};

export async function summarizeLandingSubmissions(params: {
  tenantId: string;
  pageId?: string | null;
  client?: SupabaseServiceClient;
}): Promise<{ summary: LandingSubmissionSummary; available: boolean }> {
  const sb = params.client ?? createSupabaseServiceClient();
  let query = sb
    .from("landing_page_submissions")
    .select("id, attribution, lead_status, created_at")
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (params.pageId) query = query.eq("page_id", params.pageId);

  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) {
      return {
        summary: { total: 0, last7Days: 0, leadsCreated: 0, byChannel: {} },
        available: false,
      };
    }
    console.error("[landing-submission] resumo falhou", error);
    return { summary: { total: 0, last7Days: 0, leadsCreated: 0, byChannel: {} }, available: false };
  }

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const summary: LandingSubmissionSummary = {
    total: 0,
    last7Days: 0,
    leadsCreated: 0,
    byChannel: {},
  };

  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    summary.total += 1;
    if (new Date(String(row.created_at ?? "")).getTime() >= cutoff) summary.last7Days += 1;
    if (row.lead_status === "created" || row.lead_status === "updated") summary.leadsCreated += 1;

    const channel = inferAttributionChannel(
      (row.attribution ?? {}) as LandingAttribution,
    );
    summary.byChannel[channel] = (summary.byChannel[channel] ?? 0) + 1;
  }

  return { summary, available: true };
}
