/**
 * Contrato das páginas de captura.
 *
 * Os blocos são dados, não JSX: a mesma versão tem de renderizar igual no
 * servidor hoje e daqui a um ano, mesmo que o componente mude. Por isso nada de
 * HTML livre vindo do banco — cada bloco é uma forma fechada, com campos de
 * texto, e o renderizador decide a marcação.
 */

export type LandingPageStatus = "draft" | "published" | "archived";

export type LandingDomainSource = "platform_subdomain" | "byo" | "purchased";

export type LandingDomainStatus =
  | "pending_dns"
  | "verifying"
  | "active"
  | "failed"
  | "removed";

export type LandingDomainSslStatus = "pending" | "active" | "failed";

export type LandingVersionOrigin = "manual" | "ai" | "template" | "restore";

export type LandingSubmissionLeadStatus =
  | "pending"
  | "created"
  | "updated"
  | "blocked"
  | "failed"
  | "duplicate";

/** Campos de formulário suportados. Telefone é obrigatório: é por ele que o agente atende. */
export type LandingFormFieldKind = "name" | "phone" | "email" | "text" | "textarea" | "select";

export type LandingFormField = {
  /** Chave no payload e no mapeamento para o CRM. */
  key: string;
  label: string;
  kind: LandingFormFieldKind;
  required: boolean;
  placeholder?: string;
  /** Apenas para `select`. */
  options?: string[];
};

export type LandingBlockKind =
  | "hero"
  | "benefits"
  | "proof"
  | "faq"
  | "form"
  | "cta"
  | "footer";

export type LandingHeroBlock = {
  kind: "hero";
  headline: string;
  subheadline: string;
  ctaLabel: string;
  /** Selo curto acima do título (ex.: "Atendimento em 30 segundos"). */
  eyebrow?: string;
};

export type LandingBenefitsBlock = {
  kind: "benefits";
  title: string;
  items: Array<{ title: string; description: string }>;
};

export type LandingProofBlock = {
  kind: "proof";
  title: string;
  items: Array<{ quote: string; author: string }>;
};

export type LandingFaqBlock = {
  kind: "faq";
  title: string;
  items: Array<{ question: string; answer: string }>;
};

export type LandingFormBlock = {
  kind: "form";
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  /**
   * Texto do consentimento LGPD. Obrigatório por lei e exigido pelo Google Ads
   * na landing — por isso não é opcional no contrato.
   */
  consentText: string;
};

export type LandingCtaBlock = {
  kind: "cta";
  headline: string;
  description: string;
  ctaLabel: string;
};

export type LandingFooterBlock = {
  kind: "footer";
  businessName: string;
  /** Linha legal curta. O link de privacidade é montado pelo renderizador. */
  legalLine: string;
};

export type LandingBlock =
  | LandingHeroBlock
  | LandingBenefitsBlock
  | LandingProofBlock
  | LandingFaqBlock
  | LandingFormBlock
  | LandingCtaBlock
  | LandingFooterBlock;

export type LandingTheme = {
  /** Hex sem alfa. Validado — cor inválida vira a cor da marca. */
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  /** Cantos e densidade: o suficiente para a página não parecer um template. */
  radius: "sharp" | "soft" | "round";
};

export type LandingSeo = {
  title: string;
  description: string;
  /** Sempre `noindex` enquanto rascunho — página de teste não pode ranquear. */
  indexable: boolean;
};

export type LandingVersionContent = {
  blocks: LandingBlock[];
  theme: LandingTheme;
  seo: LandingSeo;
  formFields: LandingFormField[];
};

export type LandingPageRecord = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  status: LandingPageStatus;
  ruleId: string | null;
  funnelId: string | null;
  columnId: string | null;
  publishedVersionId: string | null;
  draftVersionId: string | null;
  primaryDomainId: string | null;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LandingDomainRecord = {
  id: string;
  tenantId: string;
  pageId: string | null;
  host: string;
  source: LandingDomainSource;
  status: LandingDomainStatus;
  verificationToken: string;
  verifiedAt: string | null;
  dnsTarget: string | null;
  sslStatus: LandingDomainSslStatus;
  provider: string | null;
  providerRef: string | null;
  purchaseExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

/** Atribuição do clique. Tudo opcional: tráfego orgânico não traz nada disto. */
export type LandingAttribution = {
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  fbclid?: string;
  msclkid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
  landedAt?: string;
};
