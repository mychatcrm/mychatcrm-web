/** @type {import('next-sitemap').IConfig} */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Domínio canónico.
 *
 * A produção serve em `www` e redireciona o apex (307 de mychatcrm.com.br para
 * www.mychatcrm.com.br). O sitemap e o robots tinham o apex, ou seja: cada URL
 * que o Google lia era um redirecionamento, e o `Host:` do robots apontava
 * para o lado errado da canonicalização. Aqui normalizamos para o mesmo valor
 * que `lib/constants.ts` usa nas tags canonical.
 */
function canonicalSiteUrl() {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();
  const fallback = "https://www.mychatcrm.com.br";
  if (!raw) return fallback;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    // O apex existe mas redireciona; a versão indexável é sempre a www.
    if (url.hostname === "mychatcrm.com.br") url.hostname = "www.mychatcrm.com.br";
    return url.origin;
  } catch {
    return fallback;
  }
}

const SITE_URL = canonicalSiteUrl();

/**
 * Os artigos do blog são a maior superfície de busca do site (30 guias por
 * nicho) e não estavam no sitemap — o next-sitemap não os descobre porque a
 * rota é `[locale]/blog/[slug]`. Lemos os slugs da própria fonte para a lista
 * nunca ficar desatualizada em relação ao conteúdo publicado.
 */
function blogSlugs() {
  try {
    const file = fs.readFileSync(path.join(__dirname, "lib/blog/posts.ts"), "utf8");
    const found = [...file.matchAll(/slug:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
    return [...new Set(found)];
  } catch {
    return [];
  }
}

/** Data real da publicação, em vez da hora do build. */
function blogLastmod() {
  try {
    const file = fs.readFileSync(path.join(__dirname, "lib/blog/posts.ts"), "utf8");
    const updated = file.match(/const updatedAt = "(\d{4}-\d{2}-\d{2})"/);
    return updated ? new Date(`${updated[1]}T12:00:00Z`).toISOString() : new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

const BLOG_SLUGS = blogSlugs();
const BLOG_LASTMOD = blogLastmod();

/**
 * Só o português entra no índice.
 *
 * `/en` e `/es` existem como rotas, mas servem exatamente o mesmo conteúdo em
 * português — três URLs para a mesma página. Indexar as três divide a
 * autoridade e gera erro de hreflang no Search Console ("conteúdo declarado
 * como inglês está em português"). Ficam fora do sitemap e com noindex nas
 * páginas; quando houver tradução real, voltam.
 */
function alternates(canonicalPath) {
  const href = `${SITE_URL}${canonicalPath === "/" ? "" : canonicalPath}`;
  return [
    { href, hreflang: "pt-BR" },
    { href, hreflang: "x-default" },
  ];
}

module.exports = {
  siteUrl: SITE_URL,
  generateRobotsTxt: true,
  generateIndexSitemap: true,
  autoLastmod: true,

  exclude: [
    "/dashboard",
    "/dashboard/*",
    "/admin",
    "/admin/*",
    "/checkout/*",
    "/*/checkout/*",
    "/login",
    "/*/login",
    "/forgot-password",
    "/*/forgot-password",
    "/reset-password",
    "/manutencao",
    "/*/manutencao",
    "/*/maintenance",
    "/*/mantenimiento",
    // Locais duplicados: mesma página em português sob outro prefixo.
    "/en",
    "/en/*",
    "/es",
    "/es/*",
    // Caminhos legados que só redirecionam para os canónicos.
    "/termos",
    "/privacidade",
    "/*/termos",
    "/*/privacidade",
  ],

  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/admin",
          "/checkout",
          "/login",
          "/forgot-password",
          "/reset-password",
          "/api/",
          "/en",
          "/es",
        ],
      },
    ],
    additionalSitemaps: [`${SITE_URL}/sitemap.xml`],
  },

  transform: async (config, path) => ({
    loc: `${SITE_URL}${path}`,
    changefreq: path === "/" ? "daily" : config.changefreq,
    priority: path === "/" ? 1.0 : path === "/planos" ? 0.9 : config.priority,
    lastmod: new Date().toISOString(),
    alternateRefs: alternates(path),
  }),

  additionalPaths: async () => {
    const entries = [];

    entries.push({
      loc: SITE_URL,
      changefreq: "daily",
      priority: 1.0,
      lastmod: new Date().toISOString(),
      alternateRefs: alternates("/"),
    });

    entries.push({
      loc: `${SITE_URL}/planos`,
      changefreq: "weekly",
      priority: 0.9,
      lastmod: new Date().toISOString(),
      alternateRefs: alternates("/planos"),
    });

    entries.push({
      loc: `${SITE_URL}/blog`,
      changefreq: "weekly",
      priority: 0.8,
      lastmod: BLOG_LASTMOD,
      alternateRefs: alternates("/blog"),
    });

    for (const slug of BLOG_SLUGS) {
      entries.push({
        loc: `${SITE_URL}/blog/${slug}`,
        changefreq: "monthly",
        priority: 0.7,
        lastmod: BLOG_LASTMOD,
        alternateRefs: alternates(`/blog/${slug}`),
      });
    }

    for (const legal of ["/termos-de-uso", "/politica-de-privacidade"]) {
      entries.push({
        loc: `${SITE_URL}${legal}`,
        changefreq: "yearly",
        priority: 0.2,
        lastmod: new Date().toISOString(),
        alternateRefs: alternates(legal),
      });
    }

    return entries;
  },
};
