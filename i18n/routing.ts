import { defineRouting } from "next-intl/routing";

export const locales = ["pt-BR", "en", "es"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale = "pt-BR" satisfies Locale;

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  pathnames: {
    "/": "/",
    "/planos": {
      "pt-BR": "/planos",
      en: "/plans",
      es: "/planes",
    },
    "/checkout/[planSlug]": {
      "pt-BR": "/checkout/[planSlug]",
      en: "/checkout/[planSlug]",
      es: "/checkout/[planSlug]",
    },
    "/blog": "/blog",
    "/blog/[slug]": "/blog/[slug]",
    "/login": "/login",
    "/forgot-password": {
      "pt-BR": "/forgot-password",
      en: "/forgot-password",
      es: "/forgot-password",
    },
    "/termos": {
      "pt-BR": "/termos",
      en: "/terms",
      es: "/terminos",
    },
    "/privacidade": {
      "pt-BR": "/privacidade",
      en: "/privacy",
      es: "/privacidad",
    },
    "/manutencao": {
      "pt-BR": "/manutencao",
      en: "/maintenance",
      es: "/mantenimiento",
    },
  },
});
