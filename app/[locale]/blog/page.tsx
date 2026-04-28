import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BlogPostCard } from "@/components/blog/BlogPostCard";
import { BlogSearchForm } from "@/components/blog/BlogSearchForm";
import { JsonLd } from "@/components/JsonLd";
import { BLOG_NICHES, getBlogPostSummaries } from "@/lib/blog/posts";
import { buildBlogBreadcrumbSchema, buildBlogCollectionSchema } from "@/lib/blog/schema";
import { searchBlogPosts } from "@/lib/blog/search";
import { SITE_URL } from "@/lib/constants";
import { buildOrganizationSchema } from "@/lib/seo";
import { routing } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ q?: string | string[]; niche?: string | string[] }>;
};

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.blog" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: "/blog",
      languages: {
        "pt-BR": `${SITE_URL}/blog`,
        en: `${SITE_URL}/en/blog`,
        es: `${SITE_URL}/es/blog`,
        "x-default": `${SITE_URL}/blog`,
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: `${SITE_URL}/blog`,
      images: ["/og-image.png"],
    },
  };
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function BlogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const resolvedSearchParams = await searchParams;
  const tSeo = await getTranslations({ locale, namespace: "seo.schemas" });

  const query = getParam(resolvedSearchParams?.q);
  const niche = getParam(resolvedSearchParams?.niche);
  const posts = searchBlogPosts({ query, niche });
  const allPosts = getBlogPostSummaries();
  const structuredData = [
    buildOrganizationSchema(),
    buildBlogCollectionSchema(allPosts),
    buildBlogBreadcrumbSchema([
      { name: tSeo("breadcrumb.home"), path: "/" },
      { name: tSeo("breadcrumb.blog"), path: "/blog" },
    ]),
  ];

  return (
    <>
      {structuredData.map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <main className="bg-surface-base">
        <section className="relative overflow-hidden border-b border-line/80">
          <div className="absolute inset-0 bg-gradient-hero" aria-hidden />
          <div className="landing-hero-noise pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-screen" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div className="max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Blog MyChatCRM</p>
              <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-content sm:text-6xl lg:text-7xl">
                Estratégias de chatbot, CRM e automação para vender mais em cada nicho
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-content-secondary sm:text-xl">
                Conteúdo editorial profundo para transformar WhatsApp em atendimento inteligente, funil organizado e conversão previsível.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="#artigos" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-gradient-primary px-6 text-base font-semibold text-white shadow-cta-glow transition hover:-translate-y-0.5">
                  Explorar 30 guias
                </Link>
                <Link href="/planos" className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-line/90 px-6 text-base font-semibold text-content-secondary transition hover:border-primary/40 hover:text-primary">
                  Conhecer MyChatCRM
                </Link>
              </div>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-4">
              {["SEO + AEO", "GEO / LLMO", "CRO", "Local SEO"].map((item) => (
                <div key={item} className="rounded-3xl border border-line/80 bg-surface-card/70 p-5">
                  <p className="font-display text-lg font-bold text-content">{item}</p>
                  <p className="mt-2 text-sm leading-6 text-content-muted">Estrutura clara para humanos, buscadores e IA generativa.</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8" id="artigos">
          <BlogSearchForm query={query} niche={niche} niches={BLOG_NICHES} total={posts.length} />

          {posts.length > 0 ? (
            <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {posts.map((post, index) => (
                <BlogPostCard key={post.slug} post={post} priority={index < 3} />
              ))}
            </div>
          ) : (
            <div className="mt-10 rounded-3xl border border-line/80 bg-surface-card/75 p-8 text-center">
              <p className="font-display text-2xl font-bold text-content">Nenhum guia encontrado</p>
              <p className="mx-auto mt-3 max-w-xl text-content-secondary">
                Tente buscar por outro nicho, por termos como CRM, chatbot, automação, atendimento ou conversão.
              </p>
              <Link href="/blog" className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-primary/30 px-4 text-sm font-semibold text-primary transition hover:bg-primary/10">
                Ver todos os artigos
              </Link>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
