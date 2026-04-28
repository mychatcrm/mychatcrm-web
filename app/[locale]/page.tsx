import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import dynamic from "next/dynamic";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { SocialProofBar } from "@/components/landing/SocialProofBar";
import { Features } from "@/components/landing/Features";
import { LandingSectionSkeleton } from "@/components/landing/LandingSectionSkeleton";
import { JsonLd } from "@/components/JsonLd";
import {
  buildBreadcrumbSchema,
  buildFaqSchema,
  buildOrganizationSchema,
  buildProductSchema,
  buildSoftwareApplicationSchema,
} from "@/lib/seo";
import { SITE_URL } from "@/lib/constants";
import { LandingShell } from "@/components/landing/LandingShell";
import { routing } from "@/i18n/routing";

const HowItWorks = dynamic(
  () => import("@/components/landing/HowItWorks").then((m) => ({ default: m.HowItWorks })),
  { loading: () => <LandingSectionSkeleton className="min-h-[260px]" /> },
);

const VideoSection = dynamic(
  () => import("@/components/landing/VideoSection").then((m) => ({ default: m.VideoSection })),
  { loading: () => <LandingSectionSkeleton className="min-h-[280px]" /> },
);

const Testimonials = dynamic(
  () => import("@/components/landing/Testimonials").then((m) => ({ default: m.Testimonials })),
  { loading: () => <LandingSectionSkeleton className="min-h-[320px]" /> },
);

const SavingsCalculator = dynamic(
  () => import("@/components/landing/SavingsCalculator").then((m) => ({ default: m.SavingsCalculator })),
  { loading: () => <LandingSectionSkeleton className="min-h-[240px]" /> },
);

const Pricing = dynamic(
  () => import("@/components/landing/Pricing").then((m) => ({ default: m.Pricing })),
  { loading: () => <LandingSectionSkeleton className="min-h-[400px]" /> },
);

const FAQ = dynamic(
  () => import("@/components/landing/FAQ").then((m) => ({ default: m.FAQ })),
  { loading: () => <LandingSectionSkeleton className="min-h-[280px]" /> },
);

const Footer = dynamic(
  () => import("@/components/landing/Footer").then((m) => ({ default: m.Footer })),
  { loading: () => <LandingSectionSkeleton className="min-h-[120px]" label="A carregar rodapé…" /> },
);

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo.home" });

  return {
    title: t("title"),
    description: t("description"),
    keywords: t.raw("keywords") as string[],
    alternates: {
      canonical: "/",
      languages: {
        "pt-BR": `${SITE_URL}/`,
        en: `${SITE_URL}/en`,
        es: `${SITE_URL}/es`,
        "x-default": `${SITE_URL}/`,
      },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: SITE_URL,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: t("ogImageAlt") }],
    },
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const tSeo = await getTranslations({ locale, namespace: "seo.schemas" });

  const structuredData = [
    buildOrganizationSchema(),
    buildSoftwareApplicationSchema(),
    buildProductSchema(),
    buildFaqSchema(),
    buildBreadcrumbSchema([{ name: tSeo("breadcrumb.home"), path: "/" }]),
  ];

  return (
    <>
      {structuredData.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <LandingShell className="landing-typography">
        <Navbar />
        <main>
          <Hero />
          <SocialProofBar />
          <Features />
          <HowItWorks />
          <VideoSection />
          <Testimonials />
          <SavingsCalculator />
          <Pricing />
          <FAQ />
        </main>
        <Footer />
      </LandingShell>
    </>
  );
}
