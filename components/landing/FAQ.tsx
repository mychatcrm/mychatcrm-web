"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type FaqItem = { q: string; a: string };

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  const t = useTranslations("landing.faq");
  const items = t.raw("items") as FaqItem[];

  return (
    <section
      id="faq"
      className="relative isolate mx-auto max-w-3xl scroll-mt-24 px-4 py-24 sm:px-6 lg:px-8"
    >
      <div className="pointer-events-none absolute inset-0 z-0 rounded-2xl bg-surface-base" aria-hidden />
      <div className="relative z-10 text-center">
        <h2 className="font-display text-3xl font-bold text-content sm:text-4xl">{t("heading")}</h2>
        <div className="title-accent-line" aria-hidden />
        <p className="mt-4 text-content-secondary">{t("subheading")}</p>
      </div>
      <div className="relative z-10 mt-10 divide-y divide-line/80 overflow-hidden rounded-2xl border border-line/80 bg-surface-card">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div
              key={item.q}
              className={cn(isOpen && "border-l-[3px] border-l-primary bg-primary/5 pl-[calc(1.25rem-3px)]")}
            >
              <button
                type="button"
                className="flex w-full min-h-[44px] items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-content sm:text-base"
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${i}`}
                id={`faq-header-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{item.q}</span>
                <span className="text-primary" aria-hidden>
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    id={`faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`faq-header-${i}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-4 text-sm leading-relaxed text-content-secondary">{item.a}</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
