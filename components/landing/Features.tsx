"use client";

import { motion } from "framer-motion";
import { FEATURES } from "@/lib/constants";
import { FeatureIcon } from "./FeatureIcon";
import { MagneticParticleField } from "./MagneticParticleField";
import { cn } from "@/lib/utils";

export function Features() {
  return (
    <section id="recursos" className="relative isolate overflow-hidden py-20 sm:py-24">
      <MagneticParticleField />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-content sm:text-4xl">
            Recursos que aceleram vendas no WhatsApp
          </h2>
          <div className="title-accent-line" aria-hidden />
          <p className="mt-4 text-content-secondary/95">
            Tudo o que sua operação precisa para atender melhor, converter mais e manter o time
            alinhado — em um só lugar.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "group relative overflow-hidden rounded-2xl border border-line/80 bg-surface-card/55 p-6 shadow-elevation-1 backdrop-blur-md transition duration-300",
                "hover:-translate-y-1 hover:border-primary/40 hover:shadow-card-hover-glow motion-reduce:hover:translate-y-0",
              )}
            >
              <div className="mb-4 inline-flex rounded-xl border border-line/70 bg-primary/10 p-3 transition duration-300 group-hover:border-primary/35 group-hover:shadow-[0_0_20px_rgba(242,68,0,0.2)]">
                <FeatureIcon name={f.icon} />
              </div>
              <h3 className="text-lg font-semibold text-content">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-content-secondary">{f.description}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
