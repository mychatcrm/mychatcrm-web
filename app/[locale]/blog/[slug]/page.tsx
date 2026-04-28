import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogArticleBody } from "@/components/blog/BlogArticleBody";
import { JsonLd } from "@/components/JsonLd";
import { BLOG_POSTS, getBlogPostBySlug } from "@/lib/blog/posts";
import { buildBlogStructuredData } from "@/lib/blog/schema";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

type BlogArticlePageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    BLOG_POSTS.map((post) => ({ locale, slug: post.slug })),
  );
}

export async function generateMetadata({ params }: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    return {
      title: "Artigo não encontrado | Blog MyChatCRM",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: {
      canonical: `/blog/${post.slug}`,
      languages: {
        "pt-BR": `${SITE_URL}/blog/${post.slug}`,
        en: `${SITE_URL}/en/blog/${post.slug}`,
        es: `${SITE_URL}/es/blog/${post.slug}`,
        "x-default": `${SITE_URL}/blog/${post.slug}`,
      },
    },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `${SITE_URL}/blog/${post.slug}`,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      section: post.niche,
      tags: post.keywords,
      images: ["/og-image.png"],
    },
  };
}

export default async function BlogArticlePage({ params }: BlogArticlePageProps) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) notFound();

  return (
    <>
      {buildBlogStructuredData(post).map((data, index) => (
        <JsonLd key={index} data={data} />
      ))}
      <BlogArticleBody post={post} />
    </>
  );
}
