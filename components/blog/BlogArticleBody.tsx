import Link from "next/link";
import { BlogCta, InlineBlogCta } from "@/components/blog/BlogCta";
import { BlogIllustration } from "@/components/blog/BlogIllustration";
import type { BlogPost } from "@/lib/blog/types";
import { formatDateBR } from "@/lib/utils";

export function BlogArticleBody({ post }: { post: BlogPost }) {
  return (
    <article className="bg-surface-base">
      <header className="relative overflow-hidden border-b border-line/80">
        <div className="absolute inset-0 bg-surface-base" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:px-8 lg:py-20">
          <div>
            <Link href="/blog" className="landing-link-grow text-sm font-semibold text-primary">
              ← Voltar para o blog
            </Link>
            <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-content-muted">
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-semibold text-primary">
                {post.niche}
              </span>
              <time dateTime={post.publishedAt}>{formatDateBR(post.publishedAt)}</time>
              <span aria-hidden>•</span>
              <span>{post.readingTime}</span>
            </div>
            <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-content sm:text-5xl lg:text-6xl">
              {post.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-content-secondary">{post.subtitle}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="#cta" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-white transition-colors hover:bg-primary-hover">
                Quero aplicar no meu negócio
              </Link>
              <Link href="#resposta-rapida" className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-line/90 px-6 text-base font-semibold text-content-secondary transition hover:border-primary/40 hover:text-primary">
                Ler resposta rápida
              </Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line/80 bg-surface-card">
            <BlogIllustration post={post} variant="hero" alt={`Hero visual sobre ${post.niche}`} priority />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8">
        <div className="min-w-0 space-y-10">
          <section id="resposta-rapida" className="rounded-2xl border border-primary/30 bg-primary/10 p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Resposta rápida (AEO)</p>
            <h2 className="mt-3 font-display text-2xl font-bold text-content">Qual é a melhor estratégia?</h2>
            <p className="mt-4 text-lg leading-8 text-content-secondary">{post.quickAnswer}</p>
          </section>

          <section className="rounded-2xl border border-line/80 bg-surface-card p-6 sm:p-8">
            <h2 className="font-display text-2xl font-bold text-content">TL;DR</h2>
            <ul className="mt-5 grid gap-3">
              {post.tldr.map((item) => (
                <li key={item} className="flex gap-3 text-content-secondary">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {post.sections.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-24 space-y-5">
              {section.eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{section.eyebrow}</p> : null}
              <h2 className="font-display text-3xl font-bold tracking-tight text-content sm:text-4xl">{section.title}</h2>
              <div className="space-y-4 text-base leading-8 text-content-secondary sm:text-lg">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              {section.bullets ? (
                <ul className="grid gap-3 rounded-2xl border border-line/80 bg-surface-card p-5 sm:grid-cols-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 text-sm leading-6 text-content-secondary">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {section.subsections ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.subsections.map((subsection) => (
                    <div key={subsection.title} className="rounded-2xl border border-line/80 bg-surface-card p-5">
                      <h3 className="font-display text-xl font-bold text-content">{subsection.title}</h3>
                      <p className="mt-3 text-sm leading-6 text-content-secondary">{subsection.body}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {section.image ? (
                <figure className="overflow-hidden rounded-2xl border border-line/80 bg-surface-card">
                  <BlogIllustration post={post} variant={section.image.variant} alt={section.image.alt} />
                  <figcaption className="border-t border-line/80 px-5 py-3 text-sm text-content-muted">{section.image.caption}</figcaption>
                </figure>
              ) : null}
              {index === 1 ? <InlineBlogCta /> : null}
            </section>
          ))}

          <section className="rounded-2xl border border-line/80 bg-surface-card p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Exemplos reais</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-content">Como isso aparece no dia a dia</h2>
            <div className="mt-6 grid gap-4">
              {post.examples.map((example) => (
                <div key={example} className="rounded-2xl border border-line/80 bg-surface-deep p-4 text-content-secondary">
                  {example}
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-line/80 bg-surface-card p-6">
              <h2 className="font-display text-2xl font-bold text-content">Benefícios claros</h2>
              <ul className="mt-5 space-y-3">
                {post.benefits.map((benefit) => (
                  <li key={benefit} className="flex gap-3 text-sm leading-6 text-content-secondary">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-line/80 bg-surface-card p-6">
              <h2 className="font-display text-2xl font-bold text-content">Bloco de autoridade</h2>
              <p className="mt-5 text-sm leading-7 text-content-secondary">{post.authority}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-line/80 bg-surface-card p-6 sm:p-8">
            <h2 className="font-display text-3xl font-bold text-content">Objeções comuns</h2>
            <div className="mt-6 space-y-4">
              {post.objections.map((item) => (
                <div key={item.objection} className="rounded-2xl border border-line/80 bg-surface-deep p-5">
                  <h3 className="font-display text-lg font-bold text-content">{item.objection}</h3>
                  <p className="mt-2 text-sm leading-6 text-content-secondary">{item.answer}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line/80 bg-surface-card p-6 sm:p-8">
            <h2 className="font-display text-3xl font-bold text-content">FAQ otimizado</h2>
            <div className="mt-6 divide-y divide-line/80">
              {post.faqs.map((faq) => (
                <details key={faq.question} className="group py-4">
                  <summary className="cursor-pointer list-none font-semibold text-content marker:hidden">
                    {faq.question}
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-content-secondary">{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line/80 bg-surface-card p-6 sm:p-8">
            <h2 className="font-display text-3xl font-bold text-content">Conclusão</h2>
            <p className="mt-4 text-lg leading-8 text-content-secondary">{post.conclusion}</p>
          </section>

          <BlogCta
            title={`Transforme atendimento em conversão para ${post.niche}`}
            description="Veja como aplicar chatbot, CRM Kanban, automação, agenda e follow-up em uma operação comercial moderna, mensurável e pronta para escalar."
          />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-5">
            <div className="rounded-2xl border border-line/80 bg-surface-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Neste guia</p>
              <nav className="mt-4 space-y-2 text-sm text-content-secondary" aria-label="Sumário do artigo">
                <a className="block transition hover:text-primary" href="#resposta-rapida">
                  Resposta rápida
                </a>
                {post.sections.map((section) => (
                  <a key={section.id} className="block transition hover:text-primary" href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
              </nav>
            </div>
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5">
              <p className="text-sm font-semibold text-primary">Resumo comercial</p>
              <p className="mt-3 text-sm leading-6 text-content-secondary">
                Chatbot qualifica, CRM Kanban organiza, automação faz follow-up e o atendimento humano fecha com contexto.
              </p>
            </div>
          </div>
        </aside>
      </main>
    </article>
  );
}
