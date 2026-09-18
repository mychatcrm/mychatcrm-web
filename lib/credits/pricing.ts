/**
 * Créditos: a moeda do que a máquina produz.
 *
 * A regra que manda em toda esta tabela: **crédito nunca compra hora humana.**
 * Se uma ação aqui precisar de alguém sentado fazendo, ela não pertence a esta
 * lista — vira serviço com preço próprio e teto de quantidade. Foi assim que o
 * custo ficou sendo o do modelo (centavos) e não o da agenda de ninguém.
 *
 * Publicar não custa crédito. Gerar custa. A diferença importa: o cliente que
 * já pagou pela geração não pode ter medo de colocar no ar, e voltar para uma
 * versão anterior tem de ser grátis, senão ninguém experimenta nada.
 */

export type CreditAction =
  | "landing_generate_page"
  | "landing_generate_variant"
  | "landing_regenerate_section"
  | "landing_ad_copy_pack"
  | "landing_ai_image"
  | "landing_custom_domain_setup";

export const CREDIT_ACTION_COST: Record<CreditAction, number> = {
  landing_generate_page: 5,
  landing_generate_variant: 3,
  landing_regenerate_section: 1,
  landing_ad_copy_pack: 2,
  landing_ai_image: 1,
  landing_custom_domain_setup: 2,
};

export const CREDIT_ACTION_LABEL: Record<CreditAction, string> = {
  landing_generate_page: "Gerar página completa",
  landing_generate_variant: "Gerar variante para teste A/B",
  landing_regenerate_section: "Regenerar uma seção",
  landing_ad_copy_pack: "Pacote de anúncios para Google",
  landing_ai_image: "Imagem gerada por IA",
  landing_custom_domain_setup: "Configurar domínio próprio",
};

export function creditCostForAction(action: CreditAction): number {
  return CREDIT_ACTION_COST[action] ?? 0;
}

export function isCreditAction(value: unknown): value is CreditAction {
  return typeof value === "string" && value in CREDIT_ACTION_COST;
}

export type CreditPack = {
  code: string;
  title: string;
  credits: number;
  priceBRL: number;
  /** Variável de ambiente com o Price ID do Stripe (one-time). */
  stripePriceEnvKey: string;
  highlight?: boolean;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    code: "credits_10",
    title: "10 créditos",
    credits: 10,
    priceBRL: 97,
    stripePriceEnvKey: "STRIPE_PRICE_CREDITS_10",
  },
  {
    code: "credits_30",
    title: "30 créditos",
    credits: 30,
    priceBRL: 247,
    stripePriceEnvKey: "STRIPE_PRICE_CREDITS_30",
    highlight: true,
  },
  {
    code: "credits_100",
    title: "100 créditos",
    credits: 100,
    priceBRL: 697,
    stripePriceEnvKey: "STRIPE_PRICE_CREDITS_100",
  },
];

export function findCreditPack(code: unknown): CreditPack | null {
  const value = typeof code === "string" ? code.trim() : "";
  return CREDIT_PACKS.find((pack) => pack.code === value) ?? null;
}

/** Preço por crédito — mostrado na vitrine para o pacote maior se justificar. */
export function creditUnitPriceBRL(pack: CreditPack): number {
  return Math.round((pack.priceBRL / pack.credits) * 100) / 100;
}

/**
 * Quantas páginas publicadas cada plano inclui.
 *
 * Escada de propósito: quem cresce em tráfego pago cresce em página, e o
 * upgrade tem de doer menos que o addon avulso.
 */
export const PLAN_INCLUDED_LANDING_PAGES: Record<string, number> = {
  solo: 1,
  equipa: 3,
  escala: 10,
  enterprise: 50,
};

export const LANDING_EXTRA_PAGE_MONTHLY_BRL = 39.9;

export function includedLandingPagesForPlan(plan: string | null | undefined): number {
  const key = String(plan ?? "").trim().toLowerCase();
  return PLAN_INCLUDED_LANDING_PAGES[key] ?? PLAN_INCLUDED_LANDING_PAGES.solo;
}

export type LandingPageAllowance = {
  included: number;
  extra: number;
  cap: number;
  published: number;
  remaining: number;
};

export function resolveLandingPageAllowance(params: {
  plan: string | null | undefined;
  extraEntitlements?: number;
  publishedCount: number;
}): LandingPageAllowance {
  const included = includedLandingPagesForPlan(params.plan);
  const extra = Math.max(0, Math.floor(params.extraEntitlements ?? 0));
  const cap = included + extra;
  const published = Math.max(0, Math.floor(params.publishedCount));
  return { included, extra, cap, published, remaining: Math.max(0, cap - published) };
}
