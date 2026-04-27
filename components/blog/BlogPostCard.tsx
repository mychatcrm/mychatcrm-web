import Link from "next/link";
import { BlogIllustration } from "@/components/blog/BlogIllustration";
import type { BlogPostSummary } from "@/lib/blog/types";
import { formatDateBR } from "@/lib/utils";

export function BlogPostCard({ post, priority = false }: { post: BlogPostSummary; priority?: boolean }) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-line/80 bg-surface-card/70 shadow-elevation-2 transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-card-hover-glow">
      <Link href={`/blog/${post.slug}`} className="block" aria-label={`Ler artigo: ${post.title}`}>
        <div className="relative aspect-[16/10] overflow-hidden bg-surface-elevated">
          <BlogIllustration
            post={post}
            variant="card"
            alt={`Ilustração editorial sobre ${post.niche}`}
            priority={priority}
            className="transition duration-500 group-hover:scale-[1.035]"
          />
          <div className="absolute left-4 top-4 rounded-full border border-primary/30 bg-black/70 px-3 py-1 text-xs font-semibold text-primary backdrop-blur">
            {post.niche}
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
            <time dateTime={post.publishedAt}>{formatDateBR(post.publishedAt)}</time>
            <span aria-hidden>•</span>
            <span>{post.readingTime}</span>
          </div>
          <h2 className="font-display text-xl font-bold leading-tight text-content transition group-hover:text-primary sm:text-2xl">
            {post.title}
          </h2>
          <p className="line-clamp-3 text-sm leading-6 text-content-secondary">{post.description}</p>
          <div className="flex flex-wrap gap-2">
            {post.keywords.slice(0, 3).map((keyword) => (
              <span key={keyword} className="rounded-full border border-line/80 px-2.5 py-1 text-[11px] text-content-muted">
                {keyword}
              </span>
            ))}
          </div>
          <span className="inline-flex text-sm font-semibold text-primary">Ler guia completo →</span>
        </div>
      </Link>
    </article>
  );
}
