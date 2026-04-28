import Image from "next/image";
import { BRAND_LOGO } from "@/lib/brand";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("common.footer");

  const links = [
    { href: "/#recursos", label: t("links.resources") },
    { href: "/planos", label: t("links.plans") },
    { href: "/blog", label: t("links.blog") },
    { href: "/termos", label: t("links.terms") },
    { href: "/privacidade", label: t("links.privacy") },
  ];

  const social = [
    { href: "https://www.instagram.com/", label: t("social.instagram") },
    { href: "https://www.youtube.com/", label: t("social.youtube") },
    { href: "https://www.linkedin.com/", label: t("social.linkedin") },
    { href: "https://wa.me/", label: t("social.whatsapp") },
  ];

  return (
    <footer className="relative border-t border-line/80 bg-surface-base py-14">
      <div className="landing-footer-sep absolute inset-x-0 top-0" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[radial-gradient(ellipse_80%_80%_at_50%_100%,rgba(242,68,0,0.08),transparent_65%)] opacity-80 motion-reduce:opacity-40" aria-hidden />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:px-6 lg:flex-row lg:justify-between lg:px-8">
        <div className="max-w-sm">
          <Link href="/" className="flex items-center gap-2" aria-label={t("logoAriaLabel")}>
            <Image src={BRAND_LOGO.default} alt={t("logoAriaLabel")} width={40} height={40} />
            <span className="font-display text-lg font-bold">
              <span className="text-primary">My</span>
              <span className="text-content">ChatCRM</span>
            </span>
          </Link>
          <p className="mt-3 text-sm text-content-secondary">{t("tagline")}</p>
        </div>
        <nav aria-label={t("navAriaLabel")}>
          <ul className="flex flex-col gap-3 text-sm text-content-secondary sm:flex-row sm:flex-wrap sm:gap-x-6">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="landing-link-grow transition-colors hover:text-primary">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">{t("social.heading")}</p>
          <ul className="mt-3 flex flex-wrap gap-4 text-sm text-content-secondary">
            {social.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing-link-grow transition-colors hover:text-primary"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="relative mx-auto mt-12 max-w-6xl px-4 pt-10 text-center text-xs text-content-muted sm:px-6 lg:px-8">
        <span className="landing-footer-sep absolute inset-x-4 top-0 sm:inset-x-6 lg:inset-x-8" aria-hidden />
        <span className="relative inline-block pt-2">{t("copyright")}</span>
      </p>
    </footer>
  );
}
