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
