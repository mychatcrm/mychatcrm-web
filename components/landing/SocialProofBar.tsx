"use client";

import { useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

function useAnimatedNumber(target: number, decimals: number, duration = 1400) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const current = target * p;
      setVal(decimals === 0 ? Math.floor(current) : Number(current.toFixed(decimals)));
      if (p < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [inView, target, decimals, duration]);

  return { ref, val };
}

export function SocialProofBar() {
  const t = useTranslations("landing.socialProof");
  const a = useAnimatedNumber(800, 0);
  const b = useAnimatedNumber(4.9, 1);
  const c = useAnimatedNumber(5, 1);
  const d = useAnimatedNumber(99.9, 1);

  return (
    <section className="relative border-y border-line/80 bg-surface-deep/60 py-12" aria-label={t("ariaLabel")}>
      <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
        <div ref={a.ref} className="text-center">
          <p className="font-display text-lg font-semibold leading-snug sm:text-xl">
            <span className="block text-3xl font-bold text-primary sm:text-4xl">+{a.val}</span>
            <span className="text-sm text-content-muted">{t("companies")}</span>
          </p>
        </div>
        <div ref={b.ref} className="text-center">
          <p className="font-display text-lg font-semibold leading-snug sm:text-xl">
            <span className="block text-3xl font-bold text-primary sm:text-4xl">{b.val}★</span>
            <span className="text-sm text-content-muted">{t("rating")}</span>
          </p>
        </div>
        <div ref={c.ref} className="text-center">
          <p className="font-display text-lg font-semibold leading-snug sm:text-xl">
            <span className="block text-3xl font-bold text-primary sm:text-4xl">+R$ {c.val}M</span>
            <span className="text-sm text-content-muted">{t("sales")}</span>
          </p>
        </div>
        <div ref={d.ref} className="text-center">
          <p className="font-display text-lg font-semibold leading-snug sm:text-xl">
            <span className="block text-3xl font-bold text-primary sm:text-4xl">{d.val}%</span>
            <span className="text-sm text-content-muted">{t("uptime")}</span>
          </p>
        </div>
      </div>
      <p className="mx-auto mt-6 max-w-3xl px-4 text-center text-xs text-content-muted sm:text-sm">
        {t("disclaimer")}
      </p>
    </section>
  );
}
