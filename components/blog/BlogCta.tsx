import Link from "next/link";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import { linkButtonClass, LinkButton } from "@/components/ui/LinkButton";

export function BlogCta({ title, description }: { title: string; description: string }) {
  const whatsappHref = whatsappHandoffHref();

  return (
    <aside id="cta" className="overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/20 via-surface-card to-black p-6 shadow-cta-glow sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Próximo passo</p>
          <h2 className="mt-3 font-display text-2xl font-bold text-content sm:text-3xl">{title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-content-secondary sm:text-base">{description}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={linkButtonClass("gradient", "lg")}>
            Fale com especialista
          </a>
          <LinkButton href="/planos" variant="outline" size="lg">
            Ver planos
          </LinkButton>
        </div>
      </div>
    </aside>
  );
}

export function InlineBlogCta() {
  return (
    <div className="rounded-3xl border border-line/80 bg-surface-elevated/55 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">Quer transformar este guia em operação real?</p>
          <p className="mt-1 text-sm text-content-secondary">
            O MyChatCRM conecta WhatsApp, IA, CRM Kanban, agenda e follow-up em uma única jornada.
          </p>
        </div>
        <Link href="#cta" className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-primary/30 px-4 text-sm font-semibold text-primary transition hover:bg-primary/10">
          Ver estratégia
        </Link>
      </div>
    </div>
  );
}

