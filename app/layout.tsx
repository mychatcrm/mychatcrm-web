import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { BRAND_LOGO, BRAND_ORANGE } from "@/lib/brand";
import { defaultMetadata } from "@/lib/seo";
import { RootChatWidget } from "@/components/chat/RootChatWidget";
import { ChromeThemeReset } from "@/components/ChromeThemeReset";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const ANTI_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem('mcTheme')||'light';var c=document.documentElement.classList;c.remove('dim','dark');if(t==='dim')c.add('dim');else if(t==='dark')c.add('dark');}catch(e){}})();`;

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
    <html lang="pt-BR" className={inter.variable}>
      {/* Anti-flash: aplica classe de tema antes do primeiro paint */}
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      <body className="min-h-[100dvh] min-w-0 bg-surface-base font-sans text-content antialiased">
        <ThemeProvider>
          <ChromeThemeReset />
          {children}
          <Suspense fallback={null}>
            <RootChatWidget />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
