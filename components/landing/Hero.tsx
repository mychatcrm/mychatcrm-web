"use client";

import { motion } from "framer-motion";
import { linkButtonClass, LinkButton } from "@/components/ui/LinkButton";
import { Badge } from "@/components/ui/Badge";
import { WhatsAppDemo } from "./WhatsAppDemo";
import { useTranslations } from "next-intl";

const st = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 * i, duration: 0.52, ease: [0.22, 1, 0.36, 1] },
  }),
};

export function Hero() {
  const t = useTranslations("landing.hero");

  return (
    <section
      className="relative isolate overflow-hidden bg-surface-base"
      aria-labelledby="hero-title"
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 border-b border-line/80" aria-hidden />

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:gap-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-12 lg:py-24 lg:px-8">
        <div>
          <motion.div custom={0} initial="hidden" animate="show" variants={st}>
            <Badge className="mb-5 inline-flex border-primary bg-primary/10 text-primary ring-1 ring-primary/15">
              {t("badge")}
            </Badge>
          </motion.div>
          <motion.h1
            id="hero-title"
            custom={1}
            initial="hidden"
            animate="show"
            variants={st}
            className="max-w-[22ch] font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.04em] text-content sm:text-5xl lg:text-[3.15rem]"
          >
            {t.rich("title", {
              primary: (chunks) => <span className="text-primary">{chunks}</span>,
            })}
          </motion.h1>
          <div className="title-accent-line" aria-hidden />
          <motion.p
            custom={2}
            initial="hidden"
            animate="show"
            variants={st}
            className="mt-5 max-w-xl text-base font-medium leading-relaxed text-content-secondary/90 sm:text-lg"
          >
            {t("description")}
          </motion.p>
          <motion.div
            custom={3}
            initial="hidden"
            animate="show"
            variants={st}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <a
              href="https://wa.me/"
              target="_blank"
              rel="noopener noreferrer"
              data-cursor-expand
              className={linkButtonClass("gradient", "lg", "w-full sm:w-auto")}
              aria-label={t("ctaTryAriaLabel")}
            >
              {t("ctaTry")}
            </a>
            <LinkButton
              href="/login"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
              aria-label={t("ctaTestAriaLabel")}
              data-cursor-expand
            >
              {t("ctaTest")}
            </LinkButton>
            <LinkButton
              href="/planos"
              variant="ghost"
              size="lg"
              className="landing-ghost-cta w-full rounded-xl sm:w-auto"
              aria-label={t("ctaPlansAriaLabel")}
              data-cursor-expand
            >
              {t("ctaPlans")}
            </LinkButton>
          </motion.div>
          <motion.ul
            custom={4}
            initial="hidden"
            animate="show"
            variants={st}
            className="mt-10 flex flex-wrap gap-3 text-xs text-content-secondary sm:text-sm"
          >
            {(t.raw("pills") as string[]).map((pill: string) => (
              <li
                key={pill}
                className="rounded-full border border-line/90 bg-surface-elevated/70 px-3 py-2 transition duration-200 hover:border-primary/35 hover:bg-surface-elevated/90 motion-reduce:transition-none"
              >
                {pill}
              </li>
            ))}
          </motion.ul>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative [perspective:1400px] motion-reduce:[perspective:none]"
        >
          <div className="duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transform-none lg:transition-transform lg:hover:[transform:rotateX(3deg)_rotateY(-4deg)_translateZ(0)]">
            <WhatsAppDemo />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
