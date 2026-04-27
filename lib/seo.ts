import { BRAND_LOGO } from "./brand";
import { FAQ_ITEMS, SITE_URL } from "./constants";
import { SALES_PLANS } from "./plans";

const title =
  "MyChatCRM — Chatbot com IA para WhatsApp | CRM Kanban";

const description =
  "MyChatCRM: chatbot com IA para WhatsApp, CRM Kanban, Google Agenda e follow-up automático. API oficial Meta, treinamento por especialistas e integrações. Automatize vendas e atendimento 24h.";

export const defaultMetadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  keywords: [
    "MyChatCRM",
    "chatbot WhatsApp",
    "IA WhatsApp",
    "CRM WhatsApp",
    "CRM Kanban vendas",
    "API oficial WhatsApp",
    "automação atendimento",
    "Google Agenda",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: "MyChatCRM",
    title,
    description,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "MyChatCRM — Chatbot com IA para WhatsApp",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export function buildFaqSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "MyChatCRM",
    url: SITE_URL,
    logo: `${SITE_URL}${BRAND_LOGO.default}`,
    description:
      "Plataforma SaaS brasileira de chatbot com IA para WhatsApp com CRM Kanban e Agenda integrados.",
    sameAs: [
      "https://www.instagram.com/",
      "https://www.youtube.com/",
      "https://www.linkedin.com/",
      "https://wa.me/",
    ],
  };
}

export function buildSoftwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "MyChatCRM",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "AggregateOffer",
      lowPrice: Math.min(
        ...SALES_PLANS.map((p) => p.priceMonthly).filter((n): n is number => typeof n === "number"),
      ).toFixed(2),
      highPrice: Math.max(
        ...SALES_PLANS.map((p) => p.priceMonthly).filter((n): n is number => typeof n === "number"),
      ).toFixed(2),
      priceCurrency: "BRL",
      offerCount: SALES_PLANS.filter((p) => typeof p.priceMonthly === "number").length,
    },
    description:
      "Automatize atendimento e vendas no WhatsApp com IA, CRM Kanban, funil e integração com Google Agenda.",
  };
}

export function buildProductSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "MyChatCRM — Plano Escala",
    brand: { "@type": "Brand", name: "MyChatCRM" },
    description:
      "Plano Escala com CRM Kanban completo, agenda de eventos, disparos em massa e limite ampliado de leads atendidos por mês.",
    sku: "mychatcrm-escala",
    offers: {
      "@type": "Offer",
      url: `${SITE_URL}/planos`,
      priceCurrency: "BRL",
      price: "997.00",
      priceValidUntil: "2027-12-31",
      availability: "https://schema.org/InStock",
    },
  };
}

export function buildBreadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}
