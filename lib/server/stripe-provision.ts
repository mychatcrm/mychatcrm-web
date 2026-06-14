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

/**
 * Idempotente: se o tenant já existe para este e-mail, retorna o token de ativação existente
 * (ou cria um novo se o anterior já foi usado).
 */
export async function provisionFromStripeSession(
  session: Stripe.Checkout.Session,
): Promise<ProvisionResult> {
  const sb = createSupabaseServiceClient();

  const email = (session.customer_email ?? "").toLowerCase().trim();
  const name = (session.metadata?.customerName ?? "").trim() || email.split("@")[0];
  const company = (session.metadata?.company ?? "").trim() || name;
  const planSlug = ((session.metadata?.planSlug as NormalizedPlan) ?? "solo") as NormalizedPlan;
  const billingCycle = session.metadata?.billingCycle ?? "monthly";
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : null;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

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
        const token = await ensureActivationToken(sb, dup.tenant_id as string, dup.id as string, email);
        return { tenantId: dup.tenant_id as string, memberId: dup.id as string, email, activationToken: token };
      }
    }
    throw new Error(`[stripe-provision] upsert_tenant_member: ${memberErr.message}`);
  }

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
      stripe_session_id: session.id,
    },
    { onConflict: "tenant_id" },
  );
  if (subErr) console.warn("[stripe-provision] stripe_subscriptions:", subErr.message);

  // --- Gerar token de ativação de senha ---
  const activationToken = await ensureActivationToken(sb, tenantId, memberId, email);

  console.log("[stripe-provision] Tenant provisionado:", tenantId, "plano:", planSlug, "email:", email);

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
