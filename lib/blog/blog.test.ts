import { describe, expect, it } from "vitest";
import { BLOG_NICHES, BLOG_POSTS, getBlogPostBySlug } from "./posts";
import { searchBlogPosts } from "./search";

describe("blog corpus", () => {
  it("contains exactly 30 posts with unique niches and slugs", () => {
    expect(BLOG_POSTS).toHaveLength(30);
    expect(new Set(BLOG_POSTS.map((post) => post.slug)).size).toBe(30);
    expect(new Set(BLOG_NICHES).size).toBe(30);
  });

  it("keeps each article structured for SEO, AEO and conversion", () => {
    for (const post of BLOG_POSTS) {
      expect(post.quickAnswer).toMatch(/chatbot/i);
      expect(post.quickAnswer).toMatch(/CRM/i);
      expect(post.tldr.length).toBeGreaterThanOrEqual(5);
      expect(post.sections.length).toBeGreaterThanOrEqual(6);
      expect(post.faqs.length).toBeGreaterThanOrEqual(4);
      expect(post.benefits.join(" ")).toMatch(/convers/i);
    }
  });

  it("searches by title, niche and content", () => {
    expect(searchBlogPosts({ query: "odontológicas" }).some((post) => post.slug.includes("odontologicas"))).toBe(true);
    expect(searchBlogPosts({ niche: "imobiliárias" })).toHaveLength(1);
    expect(searchBlogPosts({ query: "follow-up" }).length).toBeGreaterThan(10);
    expect(getBlogPostBySlug("chatbot-crm-software-b2b")?.niche).toBe("empresas de software B2B");
  });
});

