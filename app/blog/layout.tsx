import { DM_Sans, Syne } from "next/font/google";
import { Footer } from "@/components/landing/Footer";
import { LandingShell } from "@/components/landing/LandingShell";
import { Navbar } from "@/components/landing/Navbar";

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

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <LandingShell className={`${fontDisplay.variable} ${fontSans.variable} landing-typography`}>
      <Navbar />
      {children}
      <Footer />
    </LandingShell>
  );
}

