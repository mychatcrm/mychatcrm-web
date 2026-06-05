"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

type StepItem = { title: string; description: string };

export function HowItWorks() {
  const t = useTranslations("landing.howItWorks");
  const steps = t.raw("steps") as StepItem[];

  return (
    <section className="relative border-y border-line/80 bg-surface-deep py-20">
      <div className="pointer-events-none absolute inset-0 bg-surface-deep" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-content sm:text-4xl">{t("heading")}</h2>
          <div className="title-accent-line" aria-hidden />
          <p className="mt-4 text-content-secondary">{t("subheading")}</p>
        </div>
        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: 0.1 * i }}
              className="relative rounded-2xl border border-line/80 bg-surface-card p-6 transition-colors duration-150 hover:border-primary/30"
            >
              <span
                className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white"
                aria-hidden
              >
                {i + 1}
              </span>
              <h3 className="text-lg font-semibold text-content">{s.title}</h3>
              <p className="mt-2 text-sm text-content-secondary">{s.description}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
