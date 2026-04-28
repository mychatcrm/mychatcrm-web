"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

export function VideoSection() {
  const t = useTranslations("landing.video");
  const items = t.raw("items") as string[];

  return (
    <section id="video" className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-3xl font-bold text-content sm:text-4xl">
          {t("heading")}
        </h2>
        <div className="title-accent-line" aria-hidden />
        <p className="mt-4 text-content-secondary">{t("subheading")}</p>
      </div>
      <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:items-start">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex aspect-video flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-line/80 bg-gradient-to-br from-primary/18 via-surface-base to-surface-brown shadow-elevation-3 ring-1 ring-inset ring-white/[0.04] transition duration-500 hover:border-primary/25 hover:shadow-card-hover-glow motion-reduce:hover:shadow-elevation-3"
          role="img"
          aria-label={t("placeholderLabel")}
        >
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface-deep/80 text-2xl text-content-secondary" aria-hidden>
            ▶
          </span>
          <p className="px-6 text-center text-sm text-content-secondary">
            {t("videoPlaceholder")}
          </p>
        </motion.div>
        <aside className="rounded-2xl border border-line/80 bg-surface-card/80 p-6 shadow-elevation-1 backdrop-blur-md">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">{t("whatYouWillSee")}</h3>
          <ul className="mt-4 space-y-3 text-sm text-content-secondary">
            {items.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-0.5 text-success" aria-hidden>
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-content-muted">
            {t("disclaimerPlaceholder")}
          </p>
        </aside>
      </div>
    </section>
  );
}
