"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";
import { resetMarketingChromeTheme } from "@/lib/panel-theme-boot-script";

/**
 * Fora de `/dashboard` e `/admin`, o tema do painel não deve alterar `html`/`body`.
 * Sem isto, após alternar tema no painel, a landing herdava `backgroundColor` / `colorScheme` errados.
 */
export function ChromeThemeReset() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) return;
    resetMarketingChromeTheme();
  }, [pathname]);

  return null;
}
