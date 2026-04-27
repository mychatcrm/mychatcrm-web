"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { TESTIMONIALS } from "@/lib/constants";

export function Testimonials() {
  const scroller = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % TESTIMONIALS.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const w = card?.offsetWidth ?? 280;
    el.scrollTo({ left: idx * (w + 16), behavior: "smooth" });
  }, [idx]);

  return (
    <section
      className="relative border-y border-line/80 bg-surface-deep/90 py-20 motion-reduce:bg-surface-deep/70"
      aria-label="Depoimentos"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_0%,rgba(242,68,0,0.06),transparent_55%),linear-gradient(180deg,rgb(var(--color-surface-base)_/_0.35),transparent_40%)]"
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-content sm:text-4xl">
            Quem usa, recomenda
          </h2>
          <div className="title-accent-line" aria-hidden />
          <p className="mt-4 text-content-secondary">
            Depoimentos de clientes que transformaram atendimento e vendas com o MyChatCRM.
          </p>
        </div>

        <div
          ref={scroller}
          className="mt-12 flex min-w-0 gap-4 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] touch-pan-x md:hidden snap-x snap-mandatory"
        >
          {TESTIMONIALS.map((t, i) => (
            <article
              key={t.name + i}
              data-card="true"
              className="min-w-[85vw] snap-center rounded-2xl border border-line/80 bg-surface-card/95 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm"
            >
              <div className="flex items-center gap-3">
                <Image
                  src={t.image}
                  alt={`Foto de ${t.name}`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                />
                <div>
                  <p className="font-semibold text-content">{t.name}</p>
                  <p className="text-xs text-content-muted">
                    {t.role} · {t.company}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-primary" aria-label="5 de 5 estrelas">
                ★★★★★
              </p>
              <p className="mt-3 text-sm leading-relaxed text-content-secondary">“{t.quote}”</p>
            </article>
          ))}
        </div>

        <div className="mt-12 hidden gap-6 md:grid md:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <motion.article
              key={t.name + i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: 0.04 * i }}
              className="rounded-2xl border border-line/80 bg-surface-card/95 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm transition duration-300 hover:border-primary/25 hover:shadow-card-hover-glow motion-reduce:hover:shadow-none"
            >
              <div className="flex items-center gap-3">
                <Image
                  src={t.image}
                  alt={`Foto de ${t.name}`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                />
                <div>
                  <p className="font-semibold text-content">{t.name}</p>
                  <p className="text-xs text-content-muted">
                    {t.role} · {t.company}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-primary" aria-label="5 de 5 estrelas">
                ★★★★★
              </p>
              <p className="mt-3 text-sm leading-relaxed text-content-secondary">“{t.quote}”</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
