import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogArticleBody } from "@/components/blog/BlogArticleBody";
import { JsonLd } from "@/components/JsonLd";
import { BLOG_POSTS, getBlogPostBySlug } from "@/lib/blog/posts";
import { buildBlogStructuredData } from "@/lib/blog/schema";
import { SITE_URL } from "@/lib/constants";

type BlogArticlePageProps = {
  params: { slug: string };
};

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }: BlogArticlePageProps): Metadata {
  const post = getBlogPostBySlug(params.slug);

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
    alternates: { canonical: `/blog/${post.slug}` },
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

export default function BlogArticlePage({ params }: BlogArticlePageProps) {
  const post = getBlogPostBySlug(params.slug);

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
