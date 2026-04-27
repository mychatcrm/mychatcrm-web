import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { DM_Sans, Syne } from "next/font/google";
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

const fontDisplay = Syne({
  subsets: ["latin"],
  variable: "--font-landing-display",
  weight: ["700", "800"],
  display: "swap",
});

const fontSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-landing-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MyChatCRM | Chatbot com IA para WhatsApp e CRM Kanban",
  description:
    "Automatize atendimento e vendas no WhatsApp com IA, CRM Kanban, agenda e follow-up no MyChatCRM.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "MyChatCRM | Chatbot com IA para WhatsApp e CRM Kanban",
    description:
      "Automatize atendimento e vendas no WhatsApp com IA, CRM Kanban, agenda e follow-up no MyChatCRM.",
    url: SITE_URL,
    images: ["/og-image.png"],
  },
};

export default function HomePage() {
  const structuredData = [
    buildOrganizationSchema(),
    buildSoftwareApplicationSchema(),
    buildProductSchema(),
    buildFaqSchema(),
    buildBreadcrumbSchema([{ name: "Início", path: "/" }]),
  ];

  return (
    <>
      {structuredData.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <LandingShell className={`${fontDisplay.variable} ${fontSans.variable} landing-typography`}>
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
