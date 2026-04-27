import { BLOG_POSTS, getBlogPostSummaries } from "./posts";
import type { BlogPost, BlogPostSummary } from "./types";

export type BlogSearchParams = {
  query?: string;
  niche?: string;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getSearchIndex(post: BlogPost) {
  return normalize(
    [
      post.title,
      post.subtitle,
      post.description,
      post.niche,
      post.audience,
      post.quickAnswer,
      post.proofProblem,
      post.keywords.join(" "),
      post.tldr.join(" "),
      post.examples.join(" "),
      post.benefits.join(" "),
      post.sections.map((section) => [section.title, ...section.body, section.bullets?.join(" "), section.subsections?.map((s) => `${s.title} ${s.body}`).join(" ")].join(" ")).join(" "),
      post.faqs.map((faq) => `${faq.question} ${faq.answer}`).join(" "),
    ].join(" "),
  );
}

export function searchBlogPosts({ query, niche }: BlogSearchParams): BlogPostSummary[] {
  const q = normalize(query || "");
  const n = normalize(niche || "");

  return BLOG_POSTS.filter((post) => {
    const matchesNiche = !n || normalize(post.niche) === n;
    const matchesQuery = !q || getSearchIndex(post).includes(q);
    return matchesNiche && matchesQuery;
  }).map((post) => getBlogPostSummaries().find((summary) => summary.slug === post.slug) as BlogPostSummary);
}

