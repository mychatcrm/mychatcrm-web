/**
 * Provisionamento automático de tenant + membro após pagamento Stripe.
 * Chamado pelo webhook (checkout.session.completed) e pelo endpoint de ativação.
 */
import type Stripe from "stripe";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getPlanPolicy } from "@/lib/plan-policy";
import type { NormalizedPlan } from "@/lib/plan-policy";

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function shortId(prefix: string): string {
  return `${prefix}-${randomHex(6)}`;
}

export type ProvisionResult = {
  tenantId: string;
  memberId: string;
  email: string;
  activationToken: string;
};

const INTERNAL_TEST_CHECKOUT_SESSION_PREFIX = "internal_TEST100";

type CheckoutProvisionInput = {
  sessionId: string;
  email: string;
  name: string;
  phone: string;
  company: string;
  planSlug: NormalizedPlan;
  billingCycle: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  requireSubscriptionRecord?: boolean;
};

/**
 * Idempotente: se o tenant já existe para este e-mail, retorna o token de ativação existente
 * (ou cria um novo se o anterior já foi usado).
 */
export async function provisionFromStripeSession(
  session: Stripe.Checkout.Session,
): Promise<ProvisionResult> {
  return provisionFromCheckoutData({
    sessionId: session.id,
    email: session.customer_email ?? "",
    name: (session.metadata?.customerName ?? "").trim(),
    phone: (session.metadata?.phone ?? "").trim(),
    company: (session.metadata?.company ?? "").trim(),
    planSlug: ((session.metadata?.planSlug as NormalizedPlan) ?? "solo") as NormalizedPlan,
    billingCycle: session.metadata?.billingCycle ?? "monthly",
    stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
    stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
  });
}

export async function provisionFromInternalCheckout(params: {
  email: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  planSlug: NormalizedPlan;
  billingCycle: string;
}): Promise<ProvisionResult & { internalSessionId: string }> {
  const internalSessionId = shortId(INTERNAL_TEST_CHECKOUT_SESSION_PREFIX);
  const result = await provisionFromCheckoutData({
    sessionId: internalSessionId,
    email: params.email,
    name: params.name?.trim() ?? "",
    phone: params.phone?.trim() ?? "",
    company: params.company?.trim() ?? "",
    planSlug: params.planSlug,
    billingCycle: params.billingCycle,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    requireSubscriptionRecord: true,
  });

  return { ...result, internalSessionId };
}

async function provisionFromCheckoutData(input: CheckoutProvisionInput): Promise<ProvisionResult> {
  const sb = createSupabaseServiceClient();

  const email = input.email.toLowerCase().trim();
  const name = input.name.trim() || email.split("@")[0];
  const phone = input.phone.trim();
  const company = input.company.trim() || name;
  const planSlug = input.planSlug;
  const billingCycle = input.billingCycle;
  const stripeCustomerId = input.stripeCustomerId;
  const stripeSubscriptionId = input.stripeSubscriptionId;

  if (!email) throw new Error("[stripe-provision] Session sem e-mail do cliente.");

  // --- Idempotência: verificar se o e-mail já tem conta (normalizado pelo trigger no DB) ---
  // Usa count+head para não depender de maybeSingle() que pode retornar error com data:null.
  const { data: existingRows, error: existingErr } = await sb
    .from("tenant_members")
    .select("id, tenant_id")
    .eq("email", email) // email já normalizado acima
    .limit(1);

  if (existingErr) {
    // Não conseguimos verificar: lançar erro para o webhook reprocessar depois.
    throw new Error(`[stripe-provision] Falha ao verificar membro existente: ${existingErr.message}`);
  }

  const existingMember = existingRows?.[0] ?? null;

  if (existingMember) {
    await updateMemberPhoneIfPresent(sb, existingMember.id as string, phone);
    // Tenant já provisionado — devolver (ou criar) token de ativação
    const token = await ensureActivationToken(
      sb,
      existingMember.tenant_id as string,
      existingMember.id as string,
      email,
    );
    return {
      tenantId: existingMember.tenant_id as string,
      memberId: existingMember.id as string,
      email,
      activationToken: token,
    };
  }

  // --- Criar tenant ---
  const tenantId = shortId("tenant");
  const { error: tenantErr } = await sb.from("tenants").insert({
    id: tenantId,
    name: company,
    billing_plan: planSlug,
    status: "ativa",
  });
  if (tenantErr) throw new Error(`[stripe-provision] tenants: ${tenantErr.message}`);

  // --- Criar membro dono via RPC (hash de senha automático) ---
  const memberId = shortId("member");
  const tempPassword = randomHex(12) + "Aa1!";
  const { error: memberErr } = await sb.rpc("upsert_tenant_member", {
    p_id: memberId,
    p_tenant_id: tenantId,
    p_nome: name,
    p_email: email,
    p_password: tempPassword,
    p_funcao: "Proprietário",
    p_hierarchy_role: "director",
    p_reports_to_id: null,
    p_ativo: true,
    p_account_suspended: false,
  });
  if (memberErr) {
    // Se for violação de unicidade de e-mail (23505), buscar o membro já existente
    if (memberErr.code === "23505") {
      console.warn("[stripe-provision] Duplicata de e-mail detectada na constraint do DB, buscando membro existente.");
      const { data: dupRows } = await sb
        .from("tenant_members")
        .select("id, tenant_id")
        .eq("email", email)
        .limit(1);
      const dup = dupRows?.[0];
      if (dup) {
        await updateMemberPhoneIfPresent(sb, dup.id as string, phone);
        const token = await ensureActivationToken(sb, dup.tenant_id as string, dup.id as string, email);
        return { tenantId: dup.tenant_id as string, memberId: dup.id as string, email, activationToken: token };
      }
    }
    throw new Error(`[stripe-provision] upsert_tenant_member: ${memberErr.message}`);
  }

  await updateMemberPhoneIfPresent(sb, memberId, phone);
  await markMemberAsAccountOwner(sb, memberId);

  // --- Provisionar limites do plano ---
  const limits = getPlanPolicy(planSlug);
  const { error: provErr } = await sb.from("enterprise_provisions").insert({
    id: shortId("prov"),
    tenant_id: tenantId,
    organization_name: company,
    owner_member_id: memberId,
    owner_email: email,
    owner_name: name,
    max_directors: limits.maxDirectors,
    max_managers: limits.maxManagers,
    max_sellers: limits.maxSellers,
    included_agents: limits.includedAgents,
    max_sales_funnels: limits.maxSalesFunnels,
    monthly_leads_cap: limits.monthlyAttendedLeadsCap,
    included_whatsapp: limits.includedWhatsAppLines,
  });
  if (provErr) throw new Error(`[stripe-provision] enterprise_provisions: ${provErr.message}`);

  // --- Registrar assinatura Stripe ---
  const { error: subErr } = await sb.from("stripe_subscriptions").upsert(
    {
      tenant_id: tenantId,
      customer_id: stripeCustomerId,
      subscription_id: stripeSubscriptionId,
      plan_slug: planSlug,
      billing_cycle: billingCycle,
      status: "active",
      stripe_session_id: input.sessionId,
    },
    { onConflict: "tenant_id" },
  );
  if (subErr) {
    if (input.requireSubscriptionRecord) {
      throw new Error(`[stripe-provision] stripe_subscriptions: ${subErr.message}`);
    }
    console.warn("[stripe-provision] stripe_subscriptions:", subErr.message);
  }

  // --- Gerar token de ativação de senha ---
  const activationToken = await ensureActivationToken(sb, tenantId, memberId, email);

  console.log("[stripe-provision] Tenant provisionado:", tenantId, "plano:", planSlug, "email:", email);

  return { tenantId, memberId, email, activationToken };
}

/**
 * Marca quem acabou de assinar como titular da conta. É o que dá o papel
 * `owner` na sessão (gerir colaboradores, equipes e plano) em qualquer plano —
 * antes só tenants Enterprise conseguiam isso.
 *
 * Não derruba o provisionamento se falhar: a conta já existe e o login ainda
 * funciona; o pior caso é o titular precisar do backfill da migration.
 */
async function markMemberAsAccountOwner(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  memberId: string,
): Promise<void> {
  const { error } = await sb.from("tenant_members").update({ is_owner: true }).eq("id", memberId);
  if (error) {
    console.warn("[stripe-provision] tenant_members.is_owner:", error.message);
  }
}

async function updateMemberPhoneIfPresent(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  memberId: string,
  phone: string,
): Promise<void> {
  if (!phone) return;

  const { error } = await sb
    .from("tenant_members")
    .update({ phone })
    .eq("id", memberId);

  if (error) {
    throw new Error(`[stripe-provision] tenant_members.phone: ${error.message}`);
  }
}

export function isInternalTestCheckoutSessionId(sessionId: string): boolean {
  return sessionId.startsWith(`${INTERNAL_TEST_CHECKOUT_SESSION_PREFIX}-`);
}

export async function activateInternalCheckoutSession(sessionId: string): Promise<ProvisionResult> {
  if (!isInternalTestCheckoutSessionId(sessionId)) {
    throw new Error("[stripe-provision] Sessão interna inválida.");
  }

  const sb = createSupabaseServiceClient();
  const { data: subscription, error: subscriptionErr } = await sb
    .from("stripe_subscriptions")
    .select("tenant_id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (subscriptionErr || !subscription?.tenant_id) {
    throw new Error("[stripe-provision] Sessão interna não encontrada.");
  }

  const tenantId = subscription.tenant_id as string;
  const { data: provision, error: provisionErr } = await sb
    .from("enterprise_provisions")
    .select("owner_member_id, owner_email")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (provisionErr || !provision?.owner_member_id || !provision.owner_email) {
    throw new Error("[stripe-provision] Provisionamento interno incompleto.");
  }

  const memberId = provision.owner_member_id as string;
  const email = provision.owner_email as string;
  const activationToken = await ensureActivationToken(sb, tenantId, memberId, email);

  return { tenantId, memberId, email, activationToken };
}

async function ensureActivationToken(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
  memberId: string,
  email: string,
): Promise<string> {
  // Verifica se já existe um token não usado e não expirado
  const { data: existing } = await sb
    .from("activation_tokens")
    .select("token")
    .eq("member_id", memberId)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (existing?.token) return existing.token as string;

  // Cria novo token
  const token = randomHex(32);
  const { error } = await sb.from("activation_tokens").insert({
    token,
    tenant_id: tenantId,
    member_id: memberId,
    email,
  });
  if (error) throw new Error(`[stripe-provision] activation_tokens: ${error.message}`);
  return token;
}

/** Busca o tenant_id de uma sessão Stripe já registrada. */
export async function getTenantByStripeSession(sessionId: string): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("stripe_subscriptions")
    .select("tenant_id")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  return (data?.tenant_id as string) ?? null;
}

/** Suspende o tenant — bloqueia acesso imediato via middleware e API guard. */
export async function suspendTenant(tenantId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("tenants")
    .update({ status: "cancelada" })
    .eq("id", tenantId);
  if (error) throw new Error(`[suspendTenant] ${error.message}`);
}

/** Reativa o tenant após regularização de pagamento ou nova assinatura. Idempotente. */
export async function reactivateTenant(tenantId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("tenants")
    .update({ status: "ativa" })
    .eq("id", tenantId);
  if (error) throw new Error(`[reactivateTenant] ${error.message}`);
}
