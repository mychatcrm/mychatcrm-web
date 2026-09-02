import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import localFont from "next/font/local";
import { Manrope } from "next/font/google";
import { routing } from "@/i18n/routing";
import { LocaleHtmlLang } from "@/components/LocaleHtmlLang";
import { PreLaunchGate } from "@/components/marketing/PreLaunchGate";
import { isPreLaunchPopupEnabled } from "@/lib/server/pre-launch-config-db";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

const brandDisplay = localFont({
  src: "../../public/fonts/Manrope-SemiBold.otf",
  variable: "--font-brand-display",
  weight: "600",
  display: "swap",
});

const brandBody = Manrope({
  subsets: ["latin"],
  variable: "--font-brand-body",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * `/en` e `/es` servem exatamente a mesma página em português — são três URLs
 * para o mesmo conteúdo. Indexar as três divide a autoridade entre elas e o
 * Search Console acusa hreflang inválido ("declarado como inglês, escrito em
 * português"). Enquanto não houver tradução real, só o pt-BR entra no índice;
 * as outras continuam acessíveis e passam autoridade pelos links (`follow`).
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (locale === routing.defaultLocale) return {};
  return { robots: { index: false, follow: true } };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messages = await getMessages();
  const preLaunchPopupEnabled = await isPreLaunchPopupEnabled();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <LocaleHtmlLang />
      <div className={`${brandDisplay.variable} ${brandBody.variable} brand-marketing`}>{children}</div>
      <PreLaunchGate enabled={preLaunchPopupEnabled} />
    </NextIntlClientProvider>
  );
}
