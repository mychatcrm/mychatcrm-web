import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { BRAND_LOGO, BRAND_ORANGE } from "@/lib/brand";
import { defaultMetadata } from "@/lib/seo";
import { RootChatWidget } from "@/components/chat/RootChatWidget";
import { ChromeThemeReset } from "@/components/ChromeThemeReset";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const space = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  ...defaultMetadata,
  icons: {
    icon: [
      { url: BRAND_LOGO.icon, type: "image/svg+xml" },
      { url: BRAND_LOGO.png, type: "image/png", sizes: "512x512" },
    ],
    shortcut: BRAND_LOGO.icon,
    apple: [{ url: BRAND_LOGO.png, sizes: "512x512", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: BRAND_ORANGE,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${space.variable}`}
      style={{ backgroundColor: "#000000" }}
    >
      <body className="min-h-[100dvh] min-w-0 bg-surface-base font-sans text-content antialiased">
        <ChromeThemeReset />
        {children}
        <Suspense fallback={null}>
          <RootChatWidget />
        </Suspense>
      </body>
    </html>
  );
}
