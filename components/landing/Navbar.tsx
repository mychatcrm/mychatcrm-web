"use client";

import Image from "next/image";
import { BRAND_LOGO } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NAV_LINKS } from "@/lib/constants";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import { LinkButton, linkButtonClass } from "@/components/ui/LinkButton";

/** Espaçador ≈ barra + notch (safe-area). Menu móvel aberto aumenta a header sem alterar este valor — scroll cobre. */
const MARKETING_HEADER_OFFSET = "h-[calc(4.75rem+env(safe-area-inset-top,0px))]";

function marketingNavLinkClass(pathname: string | null, href: string): string {
  const base = "landing-link-grow text-sm font-medium transition-colors";
  if (!pathname) return `${base} text-content-secondary hover:text-primary`;
  const active =
    href === "/planos"
      ? pathname.startsWith("/planos")
      : href === "/blog"
        ? pathname.startsWith("/blog")
      : href === "/"
        ? pathname === "/"
        : false;
  return active ? `${base} text-primary` : `${base} text-content-secondary hover:text-primary`;
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const whatsappHref = whatsappHandoffHref();

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line/80 bg-[#0a0a0a]/92 backdrop-blur-md supports-[backdrop-filter]:bg-[#0a0a0a]/80">
        <nav
          className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-4 sm:gap-4 sm:px-6 lg:px-8"
          aria-label="Principal"
        >
          <Link href="/" className="flex items-center gap-2" aria-label="MyChatCRM — início">
            <Image src={BRAND_LOGO.default} alt="Logotipo MyChatCRM" width={36} height={36} priority className="h-9 w-9" />
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
                aria-current={pathname === "/" ? "page" : undefined}
              >
                Início
              </Link>
            </li>
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={marketingNavLinkClass(pathname, l.href)}
                  aria-current={
                    (l.href === "/planos" && pathname.startsWith("/planos")) ||
                    (l.href === "/blog" && pathname.startsWith("/blog"))
                      ? "page"
                      : undefined
                  }
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden items-center gap-3 md:flex">
            <LinkButton href="/login" variant="outline" size="md" aria-label="Login do cliente">
              Login
            </LinkButton>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-cursor-expand
              className={linkButtonClass("gradient", "md")}
              aria-label="Fale com especialista no WhatsApp"
            >
              Fale com especialista
            </a>
          </div>

          <button
            type="button"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line bg-[#141414] text-content md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
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
              className="border-t border-line/80 bg-[#0a0a0a] md:hidden"
            >
              <div className="flex flex-col gap-3 px-4 py-4">
                <Link
                  href="/"
                  className={`min-h-[44px] rounded-lg px-2 py-3 text-sm font-medium ${pathname === "/" ? "text-primary" : "text-content-secondary hover:text-primary"}`}
                  onClick={() => setOpen(false)}
                  aria-current={pathname === "/" ? "page" : undefined}
                >
                  Início
                </Link>
                {NAV_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`min-h-[44px] rounded-lg px-2 py-3 text-sm font-medium ${
                      (l.href === "/planos" && pathname.startsWith("/planos")) ||
                      (l.href === "/blog" && pathname.startsWith("/blog"))
                        ? "text-primary"
                        : "text-content-secondary hover:text-primary"
                    }`}
                    onClick={() => setOpen(false)}
                    aria-current={
                      (l.href === "/planos" && pathname.startsWith("/planos")) ||
                      (l.href === "/blog" && pathname.startsWith("/blog"))
                        ? "page"
                        : undefined
                    }
                  >
                    {l.label}
                  </Link>
                ))}
                <LinkButton href="/login" variant="outline" size="lg" className="w-full" onClick={() => setOpen(false)}>
                  Login
                </LinkButton>
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkButtonClass("gradient", "lg", "w-full text-center")}
                  onClick={() => setOpen(false)}
                >
                  Fale com especialista
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
