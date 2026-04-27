export type BlogImageVariant = "hero" | "workflow" | "dashboard" | "card";

export type BlogFaq = {
  question: string;
  answer: string;
};

export type BlogSubsection = {
  title: string;
  body: string;
};

export type BlogSection = {
  id: string;
  eyebrow?: string;
  title: string;
  body: string[];
  bullets?: string[];
  subsections?: BlogSubsection[];
  image?: {
    variant: BlogImageVariant;
    alt: string;
    caption: string;
  };
};

export type BlogPost = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  niche: string;
  audience: string;
  publishedAt: string;
  updatedAt: string;
  readingTime: string;
  keywords: string[];
  quickAnswer: string;
  tldr: string[];
  proofProblem: string;
  sections: BlogSection[];
  examples: string[];
  benefits: string[];
  authority: string;
  objections: { objection: string; answer: string }[];
  faqs: BlogFaq[];
  conclusion: string;
  primaryCta: string;
  secondaryCta: string;
  localSeo?: string;
};

export type BlogPostSummary = Pick<
  BlogPost,
  | "slug"
  | "title"
  | "subtitle"
  | "description"
  | "niche"
  | "audience"
  | "publishedAt"
  | "updatedAt"
  | "readingTime"
  | "keywords"
  | "quickAnswer"
>;
