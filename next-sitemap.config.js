/** @type {import('next-sitemap').IConfig} */

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "https://mychatcrm.com.br";

/** Localized slugs for routes that differ per language */
const LOCALIZED_SLUGS = {
  "/planos": { "pt-BR": "/planos", en: "/en/plans", es: "/es/planes" },
  "/termos": { "pt-BR": "/termos", en: "/en/terms", es: "/es/terminos" },
  "/privacidade": {
    "pt-BR": "/privacidade",
    en: "/en/privacy",
    es: "/es/privacidad",
  },
  "/blog": { "pt-BR": "/blog", en: "/en/blog", es: "/es/blog" },
};

/**
 * Build alternateRefs for a given canonical path.
 * Looks up localized variants in LOCALIZED_SLUGS; falls back to locale-prefixed path.
 */
function buildAlternates(canonicalPath) {
  const slugMap = LOCALIZED_SLUGS[canonicalPath];

  const ptBRHref = slugMap
    ? `${SITE_URL}${slugMap["pt-BR"]}`
    : `${SITE_URL}${canonicalPath}`;
  const enHref = slugMap
    ? `${SITE_URL}${slugMap["en"]}`
    : `${SITE_URL}/en${canonicalPath}`;
  const esHref = slugMap
    ? `${SITE_URL}${slugMap["es"]}`
    : `${SITE_URL}/es${canonicalPath}`;

  return [
    { href: ptBRHref, hreflang: "pt-BR" },
    { href: enHref, hreflang: "en" },
    { href: esHref, hreflang: "es" },
    { href: ptBRHref, hreflang: "x-default" },
  ];
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: SITE_URL,
  generateRobotsTxt: true,

  // Exclude private and non-indexable paths
  exclude: [
    "/dashboard",
    "/dashboard/*",
    "/admin",
    "/admin/*",
    // Checkout and login shouldn't be indexed (noindex set at page level too)
    "/checkout/*",
    "/login",
    "/*/login",
    "/*/checkout/*",
    // Maintenance pages shouldn't be indexed
    "/manutencao",
    "/*/maintenance",
    "/*/mantenimiento",
    // next-intl internal locale prefixes for dashboard/admin that might leak
    "/en/dashboard",
    "/es/dashboard",
  ],

  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/admin", "/checkout", "/login"],
      },
    ],
  },

  /**
   * Transform each generated URL to attach hreflang alternate refs.
   * This runs for every path that next-sitemap auto-discovers.
   */
  transform: async (config, path) => {
    // Determine canonical path (strip /en/ or /es/ prefix for lookup)
    const strippedPath = path.replace(/^\/(en|es)/, "") || "/";

    return {
      loc: `${SITE_URL}${path}`,
      changefreq: config.changefreq,
      priority: path === "/" ? 1.0 : config.priority,
      lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
      alternateRefs: buildAlternates(strippedPath === path ? path : strippedPath),
    };
  },

  /**
   * Add extra paths for localized variants that next-sitemap won't auto-detect
   * because Next.js only exports the `[locale]/...` pattern.
   */
  additionalPaths: async (config) => {
    const entries = [];

    // Localized home pages
    for (const [locale, prefix] of [
      ["pt-BR", ""],
      ["en", "/en"],
      ["es", "/es"],
    ]) {
      entries.push({
        loc: `${SITE_URL}${prefix || "/"}`,
        changefreq: "weekly",
        priority: 1.0,
        lastmod: new Date().toISOString(),
        alternateRefs: buildAlternates("/"),
      });
    }

    // Localized plans pages
    for (const [href] of [
      ["/planos"],
      ["/en/plans"],
      ["/es/planes"],
    ]) {
      entries.push({
        loc: `${SITE_URL}${href}`,
        changefreq: "weekly",
        priority: 0.9,
        lastmod: new Date().toISOString(),
        alternateRefs: buildAlternates("/planos"),
      });
    }

    // Localized legal pages
    for (const [href, canonical] of [
      ["/termos", "/termos"],
      ["/en/terms", "/termos"],
      ["/es/terminos", "/termos"],
      ["/privacidade", "/privacidade"],
      ["/en/privacy", "/privacidade"],
      ["/es/privacidad", "/privacidade"],
    ]) {
      entries.push({
        loc: `${SITE_URL}${href}`,
        changefreq: "monthly",
        priority: 0.3,
        lastmod: new Date().toISOString(),
        alternateRefs: buildAlternates(canonical),
      });
    }

    // Localized blog index
    for (const href of ["/blog", "/en/blog", "/es/blog"]) {
      entries.push({
        loc: `${SITE_URL}${href}`,
        changefreq: "weekly",
        priority: 0.8,
        lastmod: new Date().toISOString(),
        alternateRefs: buildAlternates("/blog"),
      });
    }

    return entries;
  },
};
