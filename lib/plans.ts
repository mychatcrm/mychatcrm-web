/**
 * Planos comerciais: 4 níveis (vitrine `/planos`, checkout para os 3 primeiros).
 * Limites numéricos (leads atendidos/mês, agentes, funis, hierarquia): `lib/plan-policy.ts` (`PLAN_POLICY_VERSION`).
 */

/** Ciclo de cobrança na vitrine `/planos` e no checkout (query `ciclo=`). */
export type PlanBillingCycle = "monthly" | "annual";

/** Desconto aplicado ao equivalente mensal quando o cliente escolhe faturamento anual (vitrine). */
export const PLAN_ANNUAL_DISCOUNT_PERCENT = 17;

/**
 * Cada plano inclui 2 números WhatsApp (API oficial); cada número adicional cobrado à parte.
 * São duas linhas porque formulários Meta e WhatsApp direto são atendidos por linhas
 * separadas — ver a finalidade por linha em `tenant_whatsapp_slot_state.purpose`.
 */
export const WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL = 75;
/** Todos os planos incluem um conector REST/JSON; cada conector adicional é recorrente. */
export const EXTERNAL_API_EXTRA_MONTHLY_BRL = 49.9;

const WHATSAPP_INCLUDED_LABEL = "2 números WhatsApp (API oficial)";
const WHATSAPP_EXTRA_LABEL = `+R$ ${WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL}/mês por número adicional`;

export function planEffectiveMonthlyBRL(priceMonthly: number, cycle: PlanBillingCycle): number {
  if (cycle === "monthly") return priceMonthly;
  const factor = (100 - PLAN_ANNUAL_DISCOUNT_PERCENT) / 100;
  return Math.round(priceMonthly * 100 * factor) / 100;
}

export function planAnnualCheckoutTotalsBRL(priceMonthly: number) {
  const grossAnnual = Math.round(priceMonthly * 12 * 100) / 100;
  const effectiveMonthly = planEffectiveMonthlyBRL(priceMonthly, "annual");
  const netAnnual = Math.round(effectiveMonthly * 12 * 100) / 100;
  const discountAnnual = Math.round((grossAnnual - netAnnual) * 100) / 100;
  return { grossAnnual, netAnnual, effectiveMonthly, discountAnnual };
}

export function planCheckoutChargeBaseBRL(priceMonthly: number, cycle: PlanBillingCycle): number {
  if (cycle === "annual") {
    return planAnnualCheckoutTotalsBRL(priceMonthly).netAnnual;
  }
  return planEffectiveMonthlyBRL(priceMonthly, cycle);
}

export function parsePlanBillingCycle(raw: unknown): PlanBillingCycle {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "annual" || s === "anual" || s === "yearly" || s === "ano") return "annual";
  return "monthly";
}

export type SalesPlanAccent = "default" | "popular" | "enterprise";

export type SalesPlan = {
  slug: string;
  name: string;
  tagline: string;
  /** `null` = sem checkout (plano sob medida). */
  priceMonthly: number | null;
  /** Texto curto do pacote de leads atendidos/mês (cobrança). */
  monthlyLeadsLabel: string;
  /** Resumo para vitrine: números incluídos + regra de extras. */
  whatsappNumbers: string;
  features: string[];
  accent: SalesPlanAccent;
  badge?: string;
  contactOnly?: boolean;
};

const FEATURES_ALL =
  "CRM Kanban, funis, agentes de IA, conversas em tempo real, integrações de leads, colaboradores (hierarquia), disparos em massa, agenda Google, lembretes, integrações (API, webhooks, Zapier/Make/n8n, etc.), suporte e relatórios — com os limites do plano.";

/** Solo: preço proporcional ao custo por lead dos outros planos (~R$ 0,19/lead vs ~R$ 0,10 Equipa / ~R$ 0,067 Escala). */
export const SALES_PLANS: SalesPlan[] = [
  {
    slug: "solo",
    name: "Solo",
    tagline: "Profissional autónomo: todas as ferramentas, com limites apertados e o menor preço.",
    priceMonthly: 97,
    monthlyLeadsLabel: "500 leads atendidos/mês",
    whatsappNumbers: `${WHATSAPP_INCLUDED_LABEL} · ${WHATSAPP_EXTRA_LABEL}`,
    accent: "default",
    badge: "Começar agora",
    features: [
      FEATURES_ALL,
      "Sem diretores, gerentes ou vendedores — só a sua conta (trabalho solo).",
      "Até 2 agentes de IA incluídos (+ agentes adicionais à parte).",
      "1 API externa incluída; adicionais por R$ 49,90/mês.",
      "Leads no CRM Kanban ilimitados (cadastro e integrações).",
      "Até 5 funis de vendas no CRM Kanban.",
      "Até 500 leads atendidos por mês (contagem de cobrança).",
      "Upgrade de pacote na página de planos ou com o comercial.",
    ],
  },
  {
    slug: "equipa",
    name: "Equipa",
    tagline: "Pequenas equipas com hierarquia comercial e mais volume.",
    priceMonthly: 497,
    monthlyLeadsLabel: "5.000 leads atendidos/mês",
    whatsappNumbers: `${WHATSAPP_INCLUDED_LABEL} · ${WHATSAPP_EXTRA_LABEL}`,
    accent: "default",
    badge: "PMEs",
    features: [
      FEATURES_ALL,
      "Até 1 diretor, 3 gerentes e 30 vendedores.",
      "Até 5 agentes de IA incluídos.",
      "1 API externa incluída; adicionais por R$ 49,90/mês.",
      "Leads no CRM Kanban ilimitados (cadastro e integrações).",
      "Até 12 funis de vendas no CRM Kanban.",
      "Até 5.000 leads atendidos por mês (contagem de cobrança).",
    ],
  },
  {
    slug: "escala",
    name: "Escala",
    tagline: "Operação com várias chefias e maior volume de atendimento.",
    priceMonthly: 997,
    monthlyLeadsLabel: "15.000 leads atendidos/mês",
    whatsappNumbers: `${WHATSAPP_INCLUDED_LABEL} · ${WHATSAPP_EXTRA_LABEL}`,
    accent: "popular",
    badge: "Mais escolhido",
    features: [
      FEATURES_ALL,
      "Até 5 diretores, 25 gerentes e 30 vendedores.",
      "Até 30 agentes de IA incluídos.",
      "1 API externa incluída; adicionais por R$ 49,90/mês.",
      "Leads no CRM Kanban ilimitados (cadastro e integrações).",
      "Até 25 funis de vendas no CRM Kanban.",
      "Até 15.000 leads atendidos por mês (contagem de cobrança).",
    ],
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    tagline: "Conta dedicada sob contrato — pacote e limites definidos com o comercial, à medida do cliente.",
    priceMonthly: null,
    monthlyLeadsLabel: "Sob contrato",
    whatsappNumbers: "Sob contrato",
    accent: "enterprise",
    badge: "Sob consulta",
    contactOnly: true,
    /** Vitrine sem lista de entregáveis: o pacote é sempre negociado. */
    features: [],
  },
];

/** Planos com coluna no comparativo da vitrine (Enterprise fica só nos cards / CTA). */
export const SALES_PLANS_COMPARISON_COLUMNS = SALES_PLANS.filter((p) => !p.contactOnly);

export const PLAN_CHECKOUT_SLUGS = SALES_PLANS.filter((p) => !p.contactOnly).map((p) => p.slug);

export const PLAN_SLUGS = SALES_PLANS.map((p) => p.slug);

export type PlanComparisonCellValue = boolean | string;

export type PlanComparisonCell = Record<string, PlanComparisonCellValue>;

export type PlanComparisonRow = {
  label: string;
  cells: PlanComparisonCell;
};

export type PlanComparisonSection = {
  category: string;
  rows: PlanComparisonRow[];
};

const S = "solo";
const E = "equipa";
const C = "escala";

export const PLAN_COMPARISON_SECTIONS: PlanComparisonSection[] = [
  {
    category: "Preço e contratação",
    rows: [
      {
        label: "Ativação imediata após o pagamento (planos com checkout online)",
        cells: { [S]: true, [E]: true, [C]: true },
      },
      {
        label: "7 dias para solicitar reembolso se não ficar satisfeito (planos com checkout online)",
        cells: { [S]: true, [E]: true, [C]: true },
      },
    ],
  },
  {
    category: "Limites e canais",
    rows: [
      {
        label: "Leads atendidos por mês (cobrança)",
        cells: { [S]: "500", [E]: "5.000", [C]: "15.000" },
      },
      {
        label:
          "WhatsApp no plano: 1 número (ligação API oficial Meta ou por QR Code — uma linha por plano, não cumulativo)",
        cells: { [S]: "1", [E]: "1", [C]: "1" },
      },
      {
        label: "Número WhatsApp adicional (cada)",
        cells: {
          [S]: `+R$ ${WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL}/mês`,
          [E]: `+R$ ${WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL}/mês`,
          [C]: `+R$ ${WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL}/mês`,
        },
      },
      {
        label: "APIs externas para consulta dos agentes",
        cells: { [S]: "1 incluída; +R$ 49,90/mês cada", [E]: "1 incluída; +R$ 49,90/mês cada", [C]: "1 incluída; +R$ 49,90/mês cada" },
      },
    ],
  },
  {
    category: "Agentes de IA",
    rows: [
      {
        label: "Agentes incluídos (+ extras à parte na página de agentes)",
        cells: { [S]: "2", [E]: "5", [C]: "30" },
      },
    ],
  },
  {
    category: "Colaboradores (hierarquia)",
    rows: [
      {
        label: "Limite de contas na hierarquia: diretores, gerentes de equipa e vendedores",
        cells: {
          [S]: "—",
          [E]: "1 diretor, 3 gerentes, 30 vendedores",
          [C]: "5 diretores, 25 gerentes, 30 vendedores",
        },
      },
    ],
  },
  {
    category: "CRM Kanban e conversas (mensal)",
    rows: [
      {
        label: "Leads no CRM Kanban (cadastro e integrações)",
        cells: { [S]: "Ilimitado", [E]: "Ilimitado", [C]: "Ilimitado" },
      },
      {
        label: "Funis de vendas (pipelines no CRM Kanban)",
        cells: { [S]: "5", [E]: "12", [C]: "25" },
      },
    ],
  },
  {
    category: "Atendimento e IA",
    rows: [
      {
        label: "IA 24h, voz, formulários, disparos em massa e lembretes",
        cells: { [S]: true, [E]: true, [C]: true },
      },
    ],
  },
  {
    category: "Produto, arquivos e acesso",
    rows: [
      {
        label: "Armazenamento de arquivos e app desktop",
        cells: { [S]: true, [E]: true, [C]: true },
      },
    ],
  },
  {
    category: "Integrações e dados",
    rows: [
      {
        label: "APIs externas e webhooks",
        cells: { [S]: true, [E]: true, [C]: true },
      },
    ],
  },
  {
    category: "Suporte",
    rows: [
      {
        label: "Suporte por e-mail",
        cells: { [S]: true, [E]: true, [C]: true },
      },
      {
        label: "Suporte prioritário",
        cells: { [S]: true, [E]: true, [C]: true },
      },
    ],
  },
];

export function getPlanBySlug(slug: string): SalesPlan | undefined {
  return SALES_PLANS.find((p) => p.slug === slug);
}

export function isValidPlanSlug(slug: string): slug is (typeof PLAN_SLUGS)[number] {
  return PLAN_SLUGS.includes(slug);
}
