import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  hostingerApiToken,
  isDomainPurchaseEnabled,
  landingApexIp,
  landingCnameTarget,
  landingPagesDomain,
  landingAppHosts,
  vercelDomainApi,
} from "@/lib/landing/config";
import {
  LANDING_DNS_VERIFICATION_PREFIX,
  buildLandingDnsRecords,
  txtRecordsMatchToken,
  validateLandingHost,
  type LandingDnsRecord,
} from "@/lib/landing/domain";
import { parseLandingDomain } from "@/lib/server/landing-pages-db";
import type { LandingDomainRecord } from "@/lib/landing/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const MISSING_SCHEMA_CODES = new Set(["PGRST205", "42P01"]);
const DUPLICATE_KEY_CODES = new Set(["23505"]);
const DNS_TIMEOUT_MS = 8_000;
const PROVIDER_TIMEOUT_MS = 15_000;

const DOMAIN_COLUMNS =
  "id, tenant_id, page_id, host, source, status, verification_token, verified_at, dns_target, ssl_status, provider, provider_ref, purchase_expires_at, last_checked_at, last_error, created_at";

function isSchemaMissing(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_SCHEMA_CODES.has(error.code));
}

export async function listLandingDomains(params: {
  tenantId: string;
  pageId?: string | null;
  client?: SupabaseServiceClient;
}): Promise<{ domains: LandingDomainRecord[]; available: boolean }> {
  const sb = params.client ?? createSupabaseServiceClient();
  let query = sb
    .from("landing_page_domains")
    .select(DOMAIN_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .neq("status", "removed")
    .order("created_at", { ascending: false })
    .limit(100);
  if (params.pageId) query = query.eq("page_id", params.pageId);

  const { data, error } = await query;
  if (error) {
    if (isSchemaMissing(error)) return { domains: [], available: false };
    console.error("[landing-domains] listagem falhou", error);
    return { domains: [], available: false };
  }
  return { domains: (data ?? []).map(parseLandingDomain), available: true };
}

export type AttachDomainResult =
  | { ok: true; domain: LandingDomainRecord; records: LandingDnsRecord[] }
  | {
      ok: false;
      code: "invalid" | "taken" | "schema_missing" | "failed";
      message: string;
    };

/**
 * Liga um domínio que o cliente já tem.
 *
 * Nasce em `pending_dns`, nunca em `active`: enquanto o TXT de posse não
 * aparecer, o domínio está apenas reivindicado. Sem esse passo, bastava digitar
 * o domínio de um concorrente para sequestrar o tráfego dele assim que o DNS
 * apontasse para nós.
 */
export async function attachExistingDomain(params: {
  tenantId: string;
  pageId: string;
  host: string;
  client?: SupabaseServiceClient;
}): Promise<AttachDomainResult> {
  const sb = params.client ?? createSupabaseServiceClient();
  const platformDomains = [landingPagesDomain(), ...landingAppHosts()].filter(
    (value): value is string => Boolean(value),
  );
  const check = validateLandingHost(params.host, platformDomains);
  if (!check.ok) return { ok: false, code: "invalid", message: check.message };

  const { data, error } = await sb
    .from("landing_page_domains")
    .insert({
      tenant_id: params.tenantId,
      page_id: params.pageId,
      host: check.host,
      source: "byo",
      status: "pending_dns",
      dns_target: check.kind === "apex" ? landingApexIp() : landingCnameTarget(),
    })
    .select(DOMAIN_COLUMNS)
    .single();

  if (error || !data) {
    if (isSchemaMissing(error)) {
      return { ok: false, code: "schema_missing", message: "Módulo de páginas ainda não migrado." };
    }
    if (error?.code && DUPLICATE_KEY_CODES.has(error.code)) {
      return {
        ok: false,
        code: "taken",
        message: "Este domínio já está ligado a uma página. Remova a ligação anterior antes de repetir.",
      };
    }
    console.error("[landing-domains] ligação falhou", error);
    return { ok: false, code: "failed", message: "Não foi possível ligar o domínio." };
  }

  const domain = parseLandingDomain(data);
  return {
    ok: true,
    domain,
    records: buildLandingDnsRecords({
      host: check.host,
      kind: check.kind,
      apex: check.apex,
      label: check.label,
      verificationToken: domain.verificationToken,
      cnameTarget: landingCnameTarget(),
      apexIp: landingApexIp(),
    }),
  };
}

export function dnsRecordsForDomain(domain: LandingDomainRecord): LandingDnsRecord[] {
  const check = validateLandingHost(domain.host, []);
  if (!check.ok) return [];
  return buildLandingDnsRecords({
    host: check.host,
    kind: check.kind,
    apex: check.apex,
    label: check.label,
    verificationToken: domain.verificationToken,
    cnameTarget: landingCnameTarget(),
    apexIp: landingApexIp(),
  });
}

type DohAnswer = { name?: string; type?: number; data?: string };

/**
 * Consulta DNS por HTTPS em vez do resolvedor do sistema.
 *
 * Na Vercel o resolvedor local pode devolver resposta em cache antiga, e o
 * cliente que acabou de criar o registo vê "ainda não encontrámos" por horas.
 * Dois provedores porque um deles vai estar fora do ar no dia da demonstração.
 */
async function resolveTxtOverHttps(name: string): Promise<string[]> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`,
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
      const response = await fetch(endpoint, {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => clearTimeout(timer));

      if (!response.ok) continue;
      const json = (await response.json()) as { Answer?: DohAnswer[] };
      const answers = Array.isArray(json.Answer) ? json.Answer : [];
      const txt = answers
        .filter((answer) => answer.type === 16 && typeof answer.data === "string")
        .map((answer) => String(answer.data));
      if (txt.length > 0) return txt;
    } catch {
      // Próximo provedor.
    }
  }
  return [];
}

export type VerifyDomainResult = {
  verified: boolean;
  status: LandingDomainRecord["status"];
  message: string;
  records: LandingDnsRecord[];
};

/**
 * Confere a posse e, com ela provada, regista o domínio na hospedagem para o
 * certificado sair. A ordem importa: registar antes de verificar deixaria
 * qualquer um reservar domínio alheio na nossa conta.
 */
export async function verifyLandingDomain(params: {
  tenantId: string;
  domainId: string;
  client?: SupabaseServiceClient;
}): Promise<VerifyDomainResult> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data, error } = await sb
    .from("landing_page_domains")
    .select(DOMAIN_COLUMNS)
    .eq("tenant_id", params.tenantId)
    .eq("id", params.domainId)
    .maybeSingle();

  if (error || !data) {
    return { verified: false, status: "failed", message: "Domínio não encontrado.", records: [] };
  }

  const domain = parseLandingDomain(data);
  const records = dnsRecordsForDomain(domain);
  const check = validateLandingHost(domain.host, []);
  if (!check.ok) {
    return { verified: false, status: "failed", message: check.message, records };
  }

  const txtName =
    check.kind === "apex"
      ? `${LANDING_DNS_VERIFICATION_PREFIX}.${check.apex}`
      : `${LANDING_DNS_VERIFICATION_PREFIX}.${check.label}.${check.apex}`;

  const txtRecords = await resolveTxtOverHttps(txtName);
  const matched = txtRecordsMatchToken(txtRecords, domain.verificationToken);

  if (!matched) {
    await sb
      .from("landing_page_domains")
      .update({
        status: "verifying",
        last_checked_at: new Date().toISOString(),
        last_error: txtRecords.length === 0 ? "txt_not_found" : "txt_mismatch",
        updated_at: new Date().toISOString(),
      })
      .eq("id", domain.id)
      .eq("tenant_id", params.tenantId);

    return {
      verified: false,
      status: "verifying",
      message:
        txtRecords.length === 0
          ? "Ainda não encontrámos o registo TXT. A propagação do DNS pode demorar até algumas horas."
          : "Encontrámos um TXT, mas com valor diferente. Confira se copiou o valor completo.",
      records,
    };
  }

  const registration = await registerDomainOnHost(domain.host);

  await sb
    .from("landing_page_domains")
    .update({
      status: "active",
      verified_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      last_error: registration.ok ? null : registration.error,
      ssl_status: registration.ok ? "active" : "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", domain.id)
    .eq("tenant_id", params.tenantId);

  if (domain.pageId) {
    await sb
      .from("landing_pages")
      .update({ primary_domain_id: domain.id, updated_at: new Date().toISOString() })
      .eq("id", domain.pageId)
      .eq("tenant_id", params.tenantId);
  }

  return {
    verified: true,
    status: "active",
    message: registration.ok
      ? "Domínio verificado e ativo. O certificado é emitido automaticamente."
      : "Domínio verificado. O certificado pode demorar alguns minutos a ficar pronto.",
    records,
  };
}

/**
 * Regista o domínio na hospedagem para o certificado ser emitido.
 *
 * Falha aqui não invalida a verificação: o cliente provou a posse, e o
 * certificado é reprocessável. Devolver erro apagaria o passo que ele já fez.
 */
async function registerDomainOnHost(host: string): Promise<{ ok: boolean; error: string | null }> {
  const api = vercelDomainApi();
  if (!api) return { ok: false, error: "host_api_not_configured" };

  const url = new URL(`https://api.vercel.com/v10/projects/${api.projectId}/domains`);
  if (api.teamId) url.searchParams.set("teamId", api.teamId);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${api.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: host }),
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (response.ok) return { ok: true, error: null };

    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    const code = body.error?.code ?? String(response.status);
    // Domínio já registado no projeto é sucesso, não falha.
    if (code === "domain_already_in_use" || response.status === 409) {
      return { ok: true, error: null };
    }
    return { ok: false, error: code };
  } catch (err) {
    console.error("[landing-domains] registo na hospedagem falhou", err);
    return { ok: false, error: "host_api_unreachable" };
  }
}

export async function removeLandingDomain(params: {
  tenantId: string;
  domainId: string;
  client?: SupabaseServiceClient;
}): Promise<boolean> {
  const sb = params.client ?? createSupabaseServiceClient();
  const { data } = await sb
    .from("landing_page_domains")
    .select("page_id")
    .eq("tenant_id", params.tenantId)
    .eq("id", params.domainId)
    .maybeSingle();

  const { error } = await sb
    .from("landing_page_domains")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("tenant_id", params.tenantId)
    .eq("id", params.domainId);
  if (error) return false;

  const pageId = (data as Record<string, unknown> | null)?.page_id;
  if (typeof pageId === "string") {
    await sb
      .from("landing_pages")
      .update({ primary_domain_id: null, updated_at: new Date().toISOString() })
      .eq("id", pageId)
      .eq("tenant_id", params.tenantId)
      .eq("primary_domain_id", params.domainId);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Compra de domínio
// ---------------------------------------------------------------------------

export type DomainSuggestion = {
  domain: string;
  available: boolean;
  priceBRL: number | null;
  currency: string;
};

async function hostingerRequest<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = hostingerApiToken();
  if (!token) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    const response = await fetch(`https://developers.hostinger.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      console.error("[landing-domains] Hostinger respondeu", response.status, path);
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    console.error("[landing-domains] Hostinger inacessível", err);
    return null;
  }
}

/**
 * Disponibilidade de domínio para compra.
 *
 * Sem token configurado devolve lista vazia e `available: false` em vez de
 * inventar preço — cliente não pode ver disponível o que não conseguimos
 * comprar.
 */
export async function checkDomainAvailability(params: {
  query: string;
  tlds?: string[];
}): Promise<{ suggestions: DomainSuggestion[]; enabled: boolean }> {
  if (!hostingerApiToken()) return { suggestions: [], enabled: false };

  const base = params.query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!base) return { suggestions: [], enabled: true };

  const tlds = params.tlds?.length ? params.tlds : ["com.br", "com", "app", "net"];
  const payload = await hostingerRequest<{ data?: Array<Record<string, unknown>> }>(
    "/api/domains/v1/availability",
    {
      method: "POST",
      body: JSON.stringify({ domain: base, tlds, with_alternatives: true }),
    },
  );

  const rows = payload?.data ?? [];
  const suggestions: DomainSuggestion[] = rows.map((row) => ({
    domain: String(row.domain ?? ""),
    available: row.is_available === true || row.available === true,
    priceBRL: typeof row.price === "number" ? row.price / 100 : null,
    currency: typeof row.currency === "string" ? row.currency : "BRL",
  }));

  return { suggestions: suggestions.filter((item) => item.domain), enabled: true };
}

export type PurchaseDomainResult =
  | { ok: true; domain: LandingDomainRecord; orderRef: string | null; message: string }
  | { ok: false; code: "disabled" | "invalid" | "taken" | "unavailable" | "failed"; message: string };

/**
 * Compra o domínio e já o aponta para nós.
 *
 * Só corre com `LANDING_DOMAIN_PURCHASE_ENABLED=true` **e** token presente: é
 * dinheiro a sair, e um engano de configuração que registra domínio por um ano
 * não tem desfazer. Quem chama tem de ter confirmação explícita do utilizador.
 *
 * Domínio comprado por nós nasce `active`: a posse não precisa de prova quando
 * fomos nós que registámos, e o DNS é apontado no mesmo passo.
 */
export async function purchaseDomainForPage(params: {
  tenantId: string;
  pageId: string;
  host: string;
  /** Perfil WHOIS da conta usado no registo. Obrigatório na API do registador. */
  whoisProfileId?: number | null;
  client?: SupabaseServiceClient;
}): Promise<PurchaseDomainResult> {
  if (!isDomainPurchaseEnabled()) {
    return {
      ok: false,
      code: "disabled",
      message: "A compra de domínios ainda não está ligada nesta conta.",
    };
  }

  const sb = params.client ?? createSupabaseServiceClient();
  const platformDomains = [landingPagesDomain(), ...landingAppHosts()].filter(
    (value): value is string => Boolean(value),
  );
  const check = validateLandingHost(params.host, platformDomains);
  if (!check.ok) return { ok: false, code: "invalid", message: check.message };
  if (check.kind !== "apex") {
    return {
      ok: false,
      code: "invalid",
      message: "Só é possível comprar o domínio principal, não um subdomínio.",
    };
  }

  const availability = await checkDomainAvailability({ query: check.apex.split(".")[0] ?? "" });
  const match = availability.suggestions.find((item) => item.domain === check.apex);
  if (!match?.available) {
    return { ok: false, code: "unavailable", message: "Esse domínio já não está disponível." };
  }

  const order = await hostingerRequest<{ data?: Record<string, unknown> }>(
    "/api/domains/v1/portfolio",
    {
      method: "POST",
      body: JSON.stringify({
        domain: check.apex,
        item_id: match.domain,
        payment_method_id: null,
        domain_contacts: params.whoisProfileId
          ? { owner_id: params.whoisProfileId, admin_id: params.whoisProfileId }
          : undefined,
      }),
    },
  );

  if (!order?.data) {
    return {
      ok: false,
      code: "failed",
      message: "O registador não concluiu a compra. Nada foi cobrado; tente novamente.",
    };
  }

  const orderRef = typeof order.data.id === "string" || typeof order.data.id === "number"
    ? String(order.data.id)
    : null;

  const { data, error } = await sb
    .from("landing_page_domains")
    .insert({
      tenant_id: params.tenantId,
      page_id: params.pageId,
      host: check.host,
      source: "purchased",
      // Comprado por nós: a posse é nossa, não há o que provar.
      status: "active",
      verified_at: new Date().toISOString(),
      dns_target: landingApexIp(),
      provider: "hostinger",
      provider_ref: orderRef,
    })
    .select(DOMAIN_COLUMNS)
    .single();

  if (error || !data) {
    if (error?.code && DUPLICATE_KEY_CODES.has(error.code)) {
      return { ok: false, code: "taken", message: "Este domínio já está registado na plataforma." };
    }
    console.error("[landing-domains] domínio comprado mas não gravado", error);
    return {
      ok: false,
      code: "failed",
      message: "O domínio foi comprado, mas não conseguimos ligá-lo. Contacte o suporte.",
    };
  }

  const domain = parseLandingDomain(data);

  // Aponta o DNS e regista na hospedagem. Falhas aqui são recuperáveis e não
  // desfazem a compra — o domínio já é do cliente.
  const [dns, registration] = await Promise.all([
    pointPurchasedDomainDns(check.apex),
    registerDomainOnHost(check.host),
  ]);

  await sb
    .from("landing_page_domains")
    .update({
      ssl_status: registration.ok ? "active" : "pending",
      last_error: dns.ok && registration.ok ? null : dns.error ?? registration.error,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", domain.id);

  await sb
    .from("landing_pages")
    .update({ primary_domain_id: domain.id, updated_at: new Date().toISOString() })
    .eq("id", params.pageId)
    .eq("tenant_id", params.tenantId);

  return {
    ok: true,
    domain,
    orderRef,
    message:
      dns.ok && registration.ok
        ? "Domínio comprado e ligado. Pode demorar alguns minutos até abrir."
        : "Domínio comprado. A ligação está a ser concluída — verifique daqui a alguns minutos.",
  };
}

/** Cria os registos no DNS do domínio que acabámos de comprar. */
async function pointPurchasedDomainDns(apex: string): Promise<{ ok: boolean; error: string | null }> {
  const payload = await hostingerRequest<unknown>(
    `/api/dns/v1/zones/${encodeURIComponent(apex)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        overwrite: true,
        zone: [
          { name: "@", type: "A", ttl: 3600, records: [{ content: landingApexIp() }] },
          { name: "www", type: "CNAME", ttl: 3600, records: [{ content: `${landingCnameTarget()}.` }] },
        ],
      }),
    },
  );
  return payload === null
    ? { ok: false, error: "dns_update_failed" }
    : { ok: true, error: null };
}
