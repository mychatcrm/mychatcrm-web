"use client";

import { motion } from "framer-motion";
import { linkButtonClass, LinkButton } from "@/components/ui/LinkButton";
import { Badge } from "@/components/ui/Badge";
import { WhatsAppDemo } from "./WhatsAppDemo";
import { cn } from "@/lib/utils";
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
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_85%_65%_at_50%_18%,rgba(242,68,0,0.16)_0%,transparent_58%),radial-gradient(ellipse_70%_50%_at_80%_0%,rgba(255,106,0,0.1)_0%,transparent_45%),radial-gradient(ellipse_60%_45%_at_10%_90%,rgba(242,68,0,0.06)_0%,transparent_50%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[1] animate-hero-mesh-shift opacity-70 mix-blend-screen motion-reduce:animate-none motion-reduce:opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 55% 40% at 18% 22%, rgba(255,106,0,0.14), transparent 60%), radial-gradient(ellipse 50% 45% at 88% 12%, rgba(242,68,0,0.12), transparent 55%), radial-gradient(ellipse 40% 35% at 72% 78%, rgba(255,140,0,0.08), transparent 50%)",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[2] opacity-[0.045] motion-reduce:opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='2' cy='2' r='1' fill='%23ffffff'/%3E%3C/svg%3E")`,
          backgroundSize: "40px 40px",
        }}
        aria-hidden
      />
      <div
        className="landing-hero-noise pointer-events-none absolute inset-0 z-[3] opacity-[0.06] mix-blend-overlay motion-reduce:opacity-[0.03]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-24 top-0 z-[4] h-72 w-72 rounded-full bg-primary/25 blur-3xl motion-reduce:opacity-60"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 right-0 z-[4] h-80 w-80 translate-x-1/4 rounded-full bg-primary-hover/20 blur-3xl motion-reduce:opacity-60"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 z-[4] h-64 w-64 -translate-x-1/2 rounded-full bg-primary/[0.12] blur-[100px] motion-reduce:hidden"
        aria-hidden
      />

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:gap-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-12 lg:py-24 lg:px-8">
        <div>
          <motion.div custom={0} initial="hidden" animate="show" variants={st}>
            <Badge className="mb-5 inline-flex border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15">
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
              className={cn(
                linkButtonClass("gradient", "lg", "w-full sm:w-auto"),
                "landing-cta-shimmer shadow-cta-glow motion-reduce:shadow-elevation-1",
              )}
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
                className="rounded-full border border-line/90 bg-surface-elevated/70 px-3 py-2 backdrop-blur-sm transition duration-200 hover:border-primary/35 hover:bg-surface-elevated/90 motion-reduce:transition-none"
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
