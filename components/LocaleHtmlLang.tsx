"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";

/** Updates <html lang> on the client whenever the locale changes. */
export function LocaleHtmlLang() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
