import Image from "next/image";
import Link from "next/link";
import { BRAND_LOGO } from "@/lib/brand";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import { linkButtonClass, LinkButton } from "@/components/ui/LinkButton";

export function SalesSiteHeader() {
  const whatsappHref = whatsappHandoffHref();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface-deep pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="MyChatCRM — início">
          <Image src={BRAND_LOGO.default} alt="Logotipo MyChatCRM" width={36} height={36} className="h-9 w-9" />
          <span className="font-display text-lg font-bold tracking-tight">
            <span className="text-primary">My</span>
            <span className="text-content">ChatCRM</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-3" aria-label="Navegação da página de planos">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-content-secondary transition hover:text-primary sm:px-3"
          >
            Início
          </Link>
          <Link
            href="/blog"
            className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-content-secondary transition hover:text-primary sm:px-3"
          >
            Blog
          </Link>
          <LinkButton href="/login" variant="outline" size="md">
            Login
          </LinkButton>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={linkButtonClass("gradient", "md")}
            aria-label="Fale com especialista no WhatsApp"
          >
            Fale com especialista
          </a>
        </nav>
      </div>
    </header>
  );
}
