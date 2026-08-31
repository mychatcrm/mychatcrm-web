"use client";

import Image from "next/image";
import { BRAND_LOGO } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import {
  LEGAL_PRIVACY_PATHNAME,
  LEGAL_TERMS_PATHNAME,
  canonicalizeLegalPrivacyPath,
  canonicalizeLegalTermsPath,
  localizeLegalPrivacyPath,
  localizeLegalTermsPath,
} from "@/lib/legal-routes";
import { LinkButton, linkButtonClass } from "@/components/ui/LinkButton";
import { useLocale, useTranslations } from "next-intl";

const MARKETING_HEADER_OFFSET = "h-[calc(4.75rem+env(safe-area-inset-top,0px))]";
const LANGUAGE_OPTIONS = [
  { locale: "pt-BR", label: "PT" },
  { locale: "en", label: "EN" },
  { locale: "es", label: "ES" },
] as const;

function marketingNavLinkClass(pathname: string | null, href: string): string {
  const base = "landing-link-grow text-sm font-medium transition-colors";
  if (!pathname) return `${base} text-content-secondary hover:text-primary`;
  const active =
    href === "/planos" || href === "/plans" || href === "/planes"
      ? pathname.includes("/planos") || pathname.includes("/plans") || pathname.includes("/planes")
      : href === "/blog"
        ? pathname.startsWith("/blog") || pathname.includes("/blog")
        : href === "/"
          ? pathname === "/" || /^\/[a-z]{2}(-[A-Z]{2})?$/.test(pathname)
          : false;
  return active ? `${base} text-primary` : `${base} text-content-secondary hover:text-primary`;
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const locale = useLocale();
  const whatsappHref = whatsappHandoffHref();
  const t = useTranslations("common.nav");
  const currentPath = pathname ?? "/";

  const navLinks = [
    { href: "/#recursos", label: t("resources") },
    { href: "/planos", label: t("plans") },
    { href: "/blog", label: t("blog") },
  ];

  function canonicalizePath(path: string) {
    const privacy = canonicalizeLegalPrivacyPath(path);
    if (privacy) return privacy;
    const terms = canonicalizeLegalTermsPath(path);
    if (terms) return terms;

    let canonical = path.replace(/^\/(pt-BR|en|es)(?=\/|$)/, "");
    if (canonical === "") canonical = "/";

    if (canonical === "/plans" || canonical === "/planes") canonical = "/planos";
    if (canonical === "/maintenance" || canonical === "/mantenimiento") canonical = "/manutencao";

    return canonical;
  }

  function localizePath(canonicalPath: string, nextLocale: "pt-BR" | "en" | "es") {
    if (canonicalPath === LEGAL_PRIVACY_PATHNAME) {
      return localizeLegalPrivacyPath(LEGAL_PRIVACY_PATHNAME, nextLocale);
    }
    if (canonicalPath === LEGAL_TERMS_PATHNAME) {
      return localizeLegalTermsPath(LEGAL_TERMS_PATHNAME, nextLocale);
    }

    let localized = canonicalPath;

    if (nextLocale === "en") {
      if (localized === "/planos") localized = "/plans";
      if (localized === "/manutencao") localized = "/maintenance";
      return localized === "/" ? "/en" : `/en${localized}`;
    }

    if (nextLocale === "es") {
      if (localized === "/planos") localized = "/planes";
      if (localized === "/manutencao") localized = "/mantenimiento";
      return localized === "/" ? "/es" : `/es${localized}`;
    }

    return localized === "/" ? "/pt-BR" : `/pt-BR${localized}`;
  }

  function changeLanguage(nextLocale: "pt-BR" | "en" | "es") {
    const canonical = canonicalizePath(currentPath);
    const targetPath = localizePath(canonical, nextLocale);
    const query = typeof window !== "undefined" ? window.location.search : "";
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    // Keep next-intl locale cookie in sync to avoid middleware redirecting back.
    document.cookie = `NEXT_LOCALE=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.location.assign(`${targetPath}${query}${hash}`);
    setOpen(false);
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line/80 bg-surface-deep">
        <nav
          className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-4 sm:gap-4 sm:px-6 lg:px-8"
          aria-label={t("navAriaLabel")}
        >
          <Link href="/" className="flex items-center gap-2" aria-label={t("logoAriaLabel")}>
            <Image src={BRAND_LOGO.default} alt={t("logoAlt")} width={36} height={36} priority className="h-9 w-9" />
            <span className="font-display text-lg font-bold tracking-tight">
              <span className="text-primary">My</span>
              <span className="text-content">ChatCRM</span>
            </span>
          </Link>

          <ul className="hidden items-center gap-8 md:flex">
            <li>
              <Link
                href="/"
                className={marketingNavLinkClass(pathname, "/")}
                aria-current={pathname === "/" || /^\/[a-z]{2}(-[A-Z]{2})?$/.test(pathname ?? "") ? "page" : undefined}
              >
                {t("home")}
              </Link>
            </li>
            {navLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={marketingNavLinkClass(pathname, l.href)}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-3 md:flex">
            <div className="flex items-center gap-1 rounded-lg border border-line/80 bg-surface-card p-1">
              {LANGUAGE_OPTIONS.map((option) => {
                const isActive = option.locale === locale;
                return (
                  <button
                    key={option.locale}
                    type="button"
                    onClick={() => changeLanguage(option.locale)}
                    className={`min-h-[32px] rounded-md px-2 text-xs font-semibold transition ${
                      isActive
                        ? "bg-primary text-white"
                        : "text-content-secondary hover:bg-surface-elevated/60 hover:text-content"
                    }`}
                    aria-label={t("switchLanguageAria", { language: t(`languages.${option.locale}`) })}
                    aria-pressed={isActive}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <LinkButton href="/login" variant="outline" size="md" aria-label={t("loginAriaLabel")}>
              {t("login")}
            </LinkButton>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-cursor-expand
              data-lead-gate="contact"
              className={linkButtonClass("gradient", "md")}
              aria-label={t("expertAriaLabel")}
            >
              {t("talkToExpert")}
            </a>
          </div>

          <button
            type="button"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line bg-surface-card text-content md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? t("closeMenu") : t("openMenu")}
          >
            <span className="sr-only">Menu</span>
            {open ? "✕" : "☰"}
          </button>
        </nav>

        <AnimatePresence>
          {open ? (
            <motion.div
              id="mobile-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-line/80 bg-surface-deep md:hidden"
            >
              <div className="flex flex-col gap-3 px-4 py-4">
                <div className="rounded-lg border border-line/80 bg-surface-card p-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-faint">
                    {t("languageLabel")}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {LANGUAGE_OPTIONS.map((option) => {
                      const isActive = option.locale === locale;
                      return (
                        <button
                          key={option.locale}
                          type="button"
                          onClick={() => changeLanguage(option.locale)}
                          className={`min-h-[40px] rounded-md px-2 text-sm font-semibold transition ${
                            isActive
                              ? "bg-primary text-white"
                              : "text-content-secondary hover:bg-surface-elevated/60 hover:text-content"
                          }`}
                          aria-label={t("switchLanguageAria", { language: t(`languages.${option.locale}`) })}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Link
                  href="/"
                  className={`min-h-[44px] rounded-lg px-2 py-3 text-sm font-medium ${pathname === "/" ? "text-primary" : "text-content-secondary hover:text-primary"}`}
                  onClick={() => setOpen(false)}
                  aria-current={pathname === "/" ? "page" : undefined}
                >
                  {t("home")}
                </Link>
                {navLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`min-h-[44px] rounded-lg px-2 py-3 text-sm font-medium ${
                      marketingNavLinkClass(pathname, l.href).includes("text-primary") &&
                      !marketingNavLinkClass(pathname, l.href).includes("hover:text-primary")
                        ? "text-primary"
                        : "text-content-secondary hover:text-primary"
                    }`}
                    onClick={() => setOpen(false)}
                  >
                    {l.label}
                  </Link>
                ))}
                <LinkButton href="/login" variant="outline" size="lg" className="w-full" onClick={() => setOpen(false)}>
                  {t("login")}
                </LinkButton>
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkButtonClass("gradient", "lg", "w-full text-center")}
                  onClick={() => setOpen(false)}
                >
                  {t("talkToExpert")}
                </a>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>
      <div className={MARKETING_HEADER_OFFSET} aria-hidden />
    </>
  );
}
