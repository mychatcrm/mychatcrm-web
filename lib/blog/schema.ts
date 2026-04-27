import { SITE_URL } from "@/lib/constants";
import { buildOrganizationSchema } from "@/lib/seo";
import type { BlogPost, BlogPostSummary } from "./types";

export function buildBlogCollectionSchema(posts: BlogPostSummary[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Blog MyChatCRM",
    url: `${SITE_URL}/blog`,
    inLanguage: "pt-BR",
    description:
      "Guias profissionais sobre chatbot, CRM, automação, atendimento e conversão para diferentes nichos de mercado.",
    isPartOf: buildOrganizationSchema(),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}/blog/${post.slug}`,
        name: post.title,
      })),
    },
  };
}

export function buildBlogArticleSchema(post: BlogPost) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    inLanguage: "pt-BR",
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: {
      "@type": "Organization",
      name: "MyChatCRM",
      url: SITE_URL,
    },
    publisher: buildOrganizationSchema(),
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    articleSection: post.niche,
    keywords: post.keywords,
    about: [
      { "@type": "Thing", name: "Chatbot" },
      { "@type": "Thing", name: "CRM" },
      { "@type": "Thing", name: "Automação de atendimento" },
      { "@type": "Thing", name: "Conversão comercial" },
      { "@type": "Thing", name: post.niche },
    ],
  };
}

export function buildBlogFaqSchema(post: BlogPost) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function buildBlogBreadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function buildBlogStructuredData(post: BlogPost) {
  return [
    buildOrganizationSchema(),
    buildBlogArticleSchema(post),
    buildBlogFaqSchema(post),
    buildBlogBreadcrumbSchema([
      { name: "Início", path: "/" },
      { name: "Blog", path: "/blog" },
      { name: post.niche, path: `/blog/${post.slug}` },
    ]),
  ];
}

