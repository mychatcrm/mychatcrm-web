import Image from "next/image";
import { buildBlogImageDataUri } from "@/lib/blog/images";
import type { BlogImageVariant, BlogPost, BlogPostSummary } from "@/lib/blog/types";
import { cn } from "@/lib/utils";

type BlogIllustrationProps = {
  post: Pick<BlogPost | BlogPostSummary, "title" | "niche">;
  variant: BlogImageVariant;
  alt: string;
  priority?: boolean;
  className?: string;
};

export function BlogIllustration({ post, variant, alt, priority = false, className }: BlogIllustrationProps) {
  return (
    <Image
      src={buildBlogImageDataUri(post, variant)}
      alt={alt}
      width={1400}
      height={840}
      priority={priority}
      unoptimized
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

