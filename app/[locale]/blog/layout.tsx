import { DM_Sans, Syne } from "next/font/google";
import { McxFooter, McxNav, McxPage } from "@/components/marketing/mcx";

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

/**
 * O blog é navegação pré-compra, por isso partilha a identidade das outras
 * páginas públicas. As páginas do blog só usam tokens (`bg-surface-*`,
 * `text-content-*`, `border-line`) — dentro de `.mcx` esses tokens já apontam
 * para a paleta escura, então o conteúdo acompanha sem ser reescrito.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <McxPage className={`${fontDisplay.variable} ${fontSans.variable} landing-typography`}>
      <McxNav />
      {children}
      <McxFooter />
    </McxPage>
  );
}
