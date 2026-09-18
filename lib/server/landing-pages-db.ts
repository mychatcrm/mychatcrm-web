import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { normalizeLandingVersionContent } from "@/lib/landing/blocks";
import { validateLandingSlug, suggestAlternativeSlug } from "@/lib/landing/slug";
import { buildLandingTemplateContent, type LandingTemplateSeed } from "@/lib/landing/templates";
import type {
  LandingDomainRecord,
  LandingPageRecord,
  LandingPageStatus,
  LandingVersionContent,
  LandingVersionOrigin,
} from "@/lib/landing/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const MISSING_SCHEMA_CODES = new Set(["PGRST205", "42P01"]);
const DUPLICATE_KEY_CODES = new Set(["23505"]);

export function isLandingSchemaMissing(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code));
}

function isDuplicate(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && DUPLICATE_KEY_CODES.has(error.code));
}

function parsePage(raw: unknown): LandingPageRecord {
  const row = (raw ?? {}) as Record<string, unknown>;
  const status = String(row.status ?? "draft");
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id ?? ""),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    status: (["draft", "published", "archived"].includes(status) ? status : "draft") as LandingPageStatus,
    ruleId: typeof row.rule_id === "string" ? row.rule_id : null,
    funnelId: typeof row.funnel_id === "string" ? row.funnel_id : null,
    columnId: typeof row.column_id === "string" ? row.column_id : null,
    publishedVersionId: typeof row.published_version_id === "string" ? row.published_version_id : null,
    draftVersionId: typeof row.draft_version_id === "string" ? row.draft_version_id : null,
    primaryDomainId: typeof row.primary_domain_id === "string" ? row.primary_domain_id : null,
    teamId: typeof row.team_id === "string" ? row.team_id : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function parseLandingDomain(raw: unknown): LandingDomainRecord {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id ?? ""),
    pageId: typeof row.page_id === "string" ? row.page_id : null,
    host: String(row.host ?? ""),
    source: (["platform_subdomain", "byo", "purchased"].includes(String(row.source))
      ? String(row.source)
      : "byo") as LandingDomainRecord["source"],
    status: (["pending_dns", "verifying", "active", "failed", "removed"].includes(String(row.status))
      ? String(row.status)
      : "pending_dns") as LandingDomainRecord["status"],
    verificationToken: String(row.verification_token ?? ""),
    verifiedAt: typeof row.verified_at === "string" ? row.verified_at : null,
    dnsTarget: typeof row.dns_target === "string" ? row.dns_target : null,
    sslStatus: (["pending", "active", "failed"].includes(String(row.ssl_status))
      ? String(row.ssl_status)
      : "pending") as LandingDomainRecord["sslStatus"],
    provider: typeof row.provider === "string" ? row.provider : null,
    providerRef: typeof row.provider_ref === "string" ? row.provider_ref : null,
    purchaseExpiresAt: typeof row.purchase_expires_at === "string" ? row.purchase_expires_at : null,
    lastCheckedAt: typeof row.last_checked_at === "string" ? row.last_checked_at : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    createdAt: String(row.created_at ?? ""),
  };
}

const PAGE_COLUMNS =
  "id, tenant_id, name, slug, status, rule_id, funnel_id, column_id, published_version_id, draft_version_id, primary_domain_id, team_id, created_at, updated_at";

export type LandingListResult = {
  pages: LandingPageRecord[];
  publishedCount: number;
  available: boolean;
};

export async function listLandingPages(params: {
  tenantId: string;
  includeArchived?: boolean;
  client?: SupabaseServiceClient;
}): Promise<LandingListResult> {
  const sb = params.client ?? createSupabaseServiceClient();
  let query = sb
    .from("landing_pages")
    .select(PAGE_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!params.includeArchived) query = query.neq("status", "archived");

  const { data, error } = await query;
  if (error) {
    if (isLandingSchemaMissing(error)) return { pages: [], publishedCount: 0, available: false };
    console.error("[landing] listagem falhou", error);
    return { pages: [], publishedCount: 0, available: false };
  }

  const pages = (data ?? []).map(parsePage);
  return {
    pages,
    publishedCount: pages.filter((page) => page.status === "published").length,
    available: true,
  };
}

export async function getLandingPage(params: {
  tenantId: string;
  pageId: string;
  client?: SupabaseServiceClient;
}): Promise<LandingPageRecord | null> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("landing_pages")
    .select(PAGE_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.pageId)
    .maybeSingle();
  if (error || !data) return null;
  return parsePage(data);
}

export async function countPublishedLandingPages(params: {
  tenantId: string;
  client?: SupabaseServiceClient;
}): Promise<number> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { count, error } = await sb
    .from("landing_pages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .eq("status", "published");
  if (error) return 0;
  return count ?? 0;
}

/**
 * Slug livre?
 *
 * A unicidade real é o índice do banco — esta consulta existe só para a
 * interface avisar antes de o cliente clicar. Entre a resposta daqui e o
 * insert, outro tenant pode ter levado o nome; por isso quem cria trata o
 * conflito de chave, e não confia nesta leitura.
 */
export async function isLandingSlugAvailable(params: {
  slug: string;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("landing_pages")
    .select("id")
    .eq("slug", params.slug)
    .maybeSingle();
  if (error && !isLandingSchemaMissing(error)) return false;
  return !data;
}

export type CreateLandingPageResult =
  | { ok: true; page: LandingPageRecord; versionId: string }
  | { ok: false; code: "schema_missing" | "slug_taken" | "invalid_slug" | "failed"; message: string };

export async function createLandingPage(params: {
  tenantId: string;
  name: string;
  slug: string;
  templateId: string;
  seed: LandingTemplateSeed;
  ruleId?: string | null;
  funnelId?: string | null;
  columnId?: string | null;
  teamId?: string | null;
  createdBy?: string | null;
  client?: SupabaseServiceClient;
}): Promise<CreateLandingPageResult> {
  const sb = params.client ?? createSupabaseServiceClient();
  const slugCheck = validateLandingSlug(params.slug);
  if (!slugCheck.ok) return { ok: false, code: "invalid_slug", message: slugCheck.message };

  const content = buildLandingTemplateContent(params.templateId, params.seed);

  const { data: pageRow, error: pageError } = await sb
    .from("landing_pages")
    .insert({
      tenant_id: params.tenantId,
      name: params.name.trim().slice(0, 120) || slugCheck.slug,
      slug: slugCheck.slug,
      status: "draft",
      rule_id: params.ruleId ?? null,
      funnel_id: params.funnelId ?? null,
      column_id: params.columnId ?? null,
      team_id: params.teamId ?? null,
    })
    .select(PAGE_COLUMNS)
    .single();

  if (pageError || !pageRow) {
    if (isLandingSchemaMissing(pageError)) {
      return { ok: false, code: "schema_missing", message: "Módulo de páginas ainda não migrado." };
    }
    if (isDuplicate(pageError)) {
      return { ok: false, code: "slug_taken", message: "Esse endereço já está em uso." };
    }
    console.error("[landing] criação falhou", pageError);
    return { ok: false, code: "failed", message: "Não foi possível criar a página." };
  }

  const page = parsePage(pageRow);
  const version = await insertLandingVersion({
    sb,
    tenantId: params.tenantId,
    pageId: page.id,
    content,
    origin: "template",
    creditsSpent: 0,
    createdBy: params.createdBy ?? null,
  });

  if (!version) {
    // Página sem versão não renderiza — melhor não existir do que existir quebrada.
    await sb.from("landing_pages").delete().eq("id", page.id).eq("tenant_id", params.tenantId);
    return { ok: false, code: "failed", message: "Não foi possível criar o conteúdo inicial." };
  }

  await sb
    .from("landing_pages")
    .update({ draft_version_id: version.id, updated_at: new Date().toISOString() })
    .eq("id", page.id)
    .eq("tenant_id", params.tenantId);

  return { ok: true, page: { ...page, draftVersionId: version.id }, versionId: version.id };
}

/** Próximo slug livre a partir de uma base. Determinístico e com teto de tentativas. */
export async function resolveAvailableSlug(params: {
  base: string;
  client?: SupabaseServiceClient;
  maxAttempts?: number;
}): Promise<string | null> {
  const sb = params.client ?? createSupabaseServiceClient();
  const first = validateLandingSlug(params.base);
  if (!first.ok) return null;
  if (await isLandingSlugAvailable({ slug: first.slug, client: sb })) return first.slug;

  const max = Math.min(50, Math.max(2, params.maxAttempts ?? 12));
  for (let attempt = 2; attempt <= max; attempt += 1) {
    const candidate = suggestAlternativeSlug(first.slug, attempt);
    const check = validateLandingSlug(candidate);
    if (!check.ok) continue;
    if (await isLandingSlugAvailable({ slug: check.slug, client: sb })) return check.slug;
  }
  return null;
}

export type LandingVersionRecord = {
  id: string;
  pageId: string;
  versionNo: number;
  content: LandingVersionContent;
  variantLabel: string | null;
  generatedBy: LandingVersionOrigin;
  creditsSpent: number;
  createdAt: string;
};

function parseVersion(raw: unknown): LandingVersionRecord {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    pageId: String(row.page_id ?? ""),
    versionNo: Number(row.version_no ?? 1),
    content: normalizeLandingVersionContent({
      blocks: row.blocks,
      theme: row.theme,
      seo: row.seo,
      formFields: row.form_fields,
    }),
    variantLabel: typeof row.variant_label === "string" ? row.variant_label : null,
    generatedBy: (["manual", "ai", "template", "restore"].includes(String(row.generated_by))
      ? String(row.generated_by)
      : "manual") as LandingVersionOrigin,
    creditsSpent: Number(row.credits_spent ?? 0),
    createdAt: String(row.created_at ?? ""),
  };
}

const VERSION_COLUMNS =
  "id, page_id, version_no, blocks, theme, seo, form_fields, variant_label, generated_by, credits_spent, created_at";

async function nextVersionNumber(sb: SupabaseServiceClient, pageId: string): Promise<number> {
  const { data } = await sb
    .from("landing_page_versions")
    .select("version_no")
    .eq("page_id", pageId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = Number((data as Record<string, unknown> | null)?.version_no ?? 0);
  return Number.isFinite(current) ? current + 1 : 1;
}

export async function insertLandingVersion(params: {
  sb: SupabaseServiceClient;
  tenantId: string;
  pageId: string;
  content: LandingVersionContent;
  origin: LandingVersionOrigin;
  creditsSpent: number;
  variantLabel?: string | null;
  createdBy?: string | null;
}): Promise<LandingVersionRecord | null> {
  const normalized = normalizeLandingVersionContent(params.content);
  const versionNo = await nextVersionNumber(params.sb, params.pageId);

  const { data, error } = await params.sb
    .from("landing_page_versions")
    .insert({
      page_id: params.pageId,
      tenant_id: params.tenantId,
      version_no: versionNo,
      blocks: normalized.blocks,
      theme: normalized.theme,
      seo: normalized.seo,
      form_fields: normalized.formFields,
      variant_label: params.variantLabel ?? null,
      generated_by: params.origin,
      credits_spent: Math.max(0, Math.floor(params.creditsSpent)),
      created_by: params.createdBy ?? null,
    })
    .select(VERSION_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[landing] insert de versão falhou", error);
    return null;
  }
  return parseVersion(data);
}

export async function getLandingVersion(params: {
  versionId: string;
  client?: SupabaseServiceClient;
}): Promise<LandingVersionRecord | null> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("landing_page_versions")
    .select(VERSION_COLUMNS)
    .eq("id", params.versionId)
    .maybeSingle();
  if (error || !data) return null;
  return parseVersion(data);
}

export async function listLandingVersions(params: {
  pageId: string;
  limit?: number;
  client?: SupabaseServiceClient;
}): Promise<LandingVersionRecord[]> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("landing_page_versions")
    .select(VERSION_COLUMNS)
    .eq("page_id", params.pageId)
    .order("version_no", { ascending: false })
    .limit(Math.min(50, Math.max(1, params.limit ?? 20)));
  if (error || !data) return [];
  return data.map(parseVersion);
}

export async function updateLandingPageFields(params: {
  tenantId: string;
  pageId: string;
  patch: Partial<{
    name: string;
    ruleId: string | null;
    funnelId: string | null;
    columnId: string | null;
    teamId: string | null;
    primaryDomainId: string | null;
  }>;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.patch.name !== undefined) patch.name = params.patch.name.trim().slice(0, 120);
  if (params.patch.ruleId !== undefined) patch.rule_id = params.patch.ruleId;
  if (params.patch.funnelId !== undefined) patch.funnel_id = params.patch.funnelId;
  if (params.patch.columnId !== undefined) patch.column_id = params.patch.columnId;
  if (params.patch.teamId !== undefined) patch.team_id = params.patch.teamId;
  if (params.patch.primaryDomainId !== undefined) patch.primary_domain_id = params.patch.primaryDomainId;

  const { error } = await sb
    .from("landing_pages")
    .update(patch)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.pageId);
  if (error) {
    console.error("[landing] atualização falhou", error);
    return false;
  }
  return true;
}

export async function setLandingDraftVersion(params: {
  tenantId: string;
  pageId: string;
  versionId: string;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { error } = await sb
    .from("landing_pages")
    .update({ draft_version_id: params.versionId, updated_at: new Date().toISOString() })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.pageId);
  return !error;
}

/**
 * Publicar é apontar `published_version_id` — nada é regerado nem recopiado.
 * Por isso voltar atrás é instantâneo e não custa crédito.
 */
export async function publishLandingPage(params: {
  tenantId: string;
  pageId: string;
  versionId: string;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { error } = await sb
    .from("landing_pages")
    .update({
      published_version_id: params.versionId,
      status: "published",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.pageId);
  if (error) {
    console.error("[landing] publicação falhou", error);
    return false;
  }
  return true;
}

export async function unpublishLandingPage(params: {
  tenantId: string;
  pageId: string;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { error } = await sb
    .from("landing_pages")
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.pageId);
  return !error;
}

/** Arquivar, nunca apagar — a decisão de produto da Central de Leads vale aqui também. */
export async function archiveLandingPage(params: {
  tenantId: string;
  pageId: string;
  actor: string;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { error } = await sb
    .from("landing_pages")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      archived_by: params.actor,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.pageId);
  return !error;
}

export type PublishedLandingPage = {
  page: LandingPageRecord;
  version: LandingVersionRecord;
  host: string;
};

/**
 * Resolução pública por host — o caminho quente do renderizador.
 *
 * Aceita duas formas: subdomínio da plataforma (casa por slug) e domínio do
 * cliente (casa por host ativo). Só devolve página publicada: rascunho e
 * arquivada não existem para quem visita.
 */
export async function resolvePublishedLandingByHost(params: {
  host: string;
  platformSlug: string | null;
  client?: SupabaseServiceClient;
}): Promise<PublishedLandingPage | null> {
  const sb = params.client ?? createSupabaseServiceClient();

  let pageRow: unknown = null;

  if (params.platformSlug) {
    const { data, error } = await sb
      .from("landing_pages")
      .select(PAGE_COLUMNS)
      .eq("slug", params.platformSlug)
      .eq("status", "published")
      .maybeSingle();
    if (error && !isLandingSchemaMissing(error)) {
      console.error("[landing] resolução por slug falhou", error);
    }
    pageRow = data ?? null;
  } else {
    const { data: domainRow, error: domainError } = await sb
      .from("landing_page_domains")
      .select("page_id")
      .eq("host", params.host)
      .eq("status", "active")
      .maybeSingle();
    if (domainError && !isLandingSchemaMissing(domainError)) {
      console.error("[landing] resolução por domínio falhou", domainError);
    }
    const pageId = (domainRow as Record<string, unknown> | null)?.page_id;
    if (typeof pageId !== "string") return null;

    const { data } = await sb
      .from("landing_pages")
      .select(PAGE_COLUMNS)
      .eq("id", pageId)
      .eq("status", "published")
      .maybeSingle();
    pageRow = data ?? null;
  }

  if (!pageRow) return null;
  const page = parsePage(pageRow);
  if (!page.publishedVersionId) return null;

  const version = await getLandingVersion({ versionId: page.publishedVersionId, client: sb });
  if (!version) return null;

  return { page, version, host: params.host };
}
