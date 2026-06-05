"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type TestimonialItem = { name: string; role: string; company: string; quote: string; image: string };

export function Testimonials() {
  const scroller = useRef<HTMLDivElement>(null);
  const t = useTranslations("landing.testimonials");
  const items = t.raw("items") as TestimonialItem[];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % items.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, [items.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const w = card?.offsetWidth ?? 280;
    el.scrollTo({ left: idx * (w + 16), behavior: "smooth" });
  }, [idx]);

  return (
    <section
      className="relative border-y border-line/80 bg-surface-deep py-20 motion-reduce:bg-surface-deep"
      aria-label={t("ariaLabel")}
    >
      <div className="pointer-events-none absolute inset-0 bg-surface-deep" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-content sm:text-4xl">
            {t("heading")}
          </h2>
          <div className="title-accent-line" aria-hidden />
          <p className="mt-4 text-content-secondary">{t("subheading")}</p>
        </div>

        <div
          ref={scroller}
          className="mt-12 flex min-w-0 gap-4 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] touch-pan-x md:hidden snap-x snap-mandatory"
        >
          {items.map((item, i) => (
            <article
              key={item.name + i}
              data-card="true"
              className="min-w-[85vw] snap-center rounded-2xl border border-line/80 bg-surface-card p-5"
            >
              <div className="flex items-center gap-3">
                <Image
                  src={item.image}
                  alt={`Foto de ${item.name}`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                />
                <div>
                  <p className="font-semibold text-content">{item.name}</p>
                  <p className="text-xs text-content-muted">
                    {item.role} · {item.company}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-primary" aria-label={t("starsAriaLabel")}>
                ★★★★★
              </p>
              <p className="mt-3 text-sm leading-relaxed text-content-secondary">&ldquo;{item.quote}&rdquo;</p>
            </article>
          ))}
        </div>

        <div className="mt-12 hidden gap-6 md:grid md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <motion.article
              key={item.name + i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: 0.04 * i }}
              className="rounded-2xl border border-line/80 bg-surface-card p-6 transition-colors duration-150 hover:border-primary/25"
            >
              <div className="flex items-center gap-3">
                <Image
                  src={item.image}
                  alt={`Foto de ${item.name}`}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                />
                <div>
                  <p className="font-semibold text-content">{item.name}</p>
                  <p className="text-xs text-content-muted">
                    {item.role} · {item.company}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-primary" aria-label={t("starsAriaLabel")}>
                ★★★★★
              </p>
              <p className="mt-3 text-sm leading-relaxed text-content-secondary">&ldquo;{item.quote}&rdquo;</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
