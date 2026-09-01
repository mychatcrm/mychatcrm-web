"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion, useInView } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Zap,
  Users,
  BarChart2,
  RefreshCw,
  Shield,
  Menu,
  X as CloseIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { planEffectiveMonthlyBRL } from "@/lib/plans";
import { SOCIAL_LINKS } from "@/lib/social-links";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";

// ---------------------------------------------------------------------------
// Animação — helpers compartilhados (sutis, respeitam prefers-reduced-motion)
// ---------------------------------------------------------------------------

/** Entrada em cascata: opacidade + leve subida, delay escalonado por índice. */
const staggerVariants = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.08 * i, duration: 0.48, ease: [0.22, 1, 0.36, 1] },
  }),
};

/**
 * Rola até a seção da âncora manualmente. O `next/link` do Next 14 nem
 * sempre dispara o scroll nativo pra links `#hash` (visto na prática: o
 * href muda, a URL atualiza, mas a página não rola) — trata na mão pra
 * garantir que funciona de verdade, em vez de confiar no automático.
 */
function handleHashNav(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith("#")) return;
  const el = document.querySelector(href);
  if (!el) return;
  event.preventDefault();
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  history.pushState(null, "", href);
}

/** Contador que anima 0→target quando entra na tela; pula direto pro valor final com reduced-motion. */
function useCountUp(target: number, { inView, reducedMotion }: { inView: boolean; reducedMotion: boolean }) {
  const [value, setValue] = useState(reducedMotion ? target : 0);
  useEffect(() => {
    if (reducedMotion) {
      setValue(target);
      return;
    }
    if (!inView) return;
    let raf = 0;
    const duration = 900;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, reducedMotion, target]);
  return value;
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

const NAV_LINKS = [
  ["Recursos", "#recursos"],
  ["Como funciona", "#como-funciona"],
  ["Planos", "#planos"],
  ["Blog", "/blog"],
] as const;

function NavV2() {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <nav
      className="sticky top-0 z-50 border-b border-mc-border"
      style={{ background: "rgba(var(--bg-rgb, 242,242,242), 0.82)", backdropFilter: "blur(12px)" }}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-8 py-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[10px]" style={{ background: "#F24400" }}>
            <div className="h-3 w-3 rounded-[50%_50%_50%_2px] border-2 border-white" />
          </div>
          <span className="text-[18px] font-bold tracking-tight text-mc-text">MyChatCRM</span>
        </div>

        {/* Links */}
        <div className="hidden items-center gap-9 md:flex">
          {NAV_LINKS.map(([label, href]) => (
            <Link
              key={label}
              href={href}
              onClick={(e) => handleHashNav(e, href)}
              className="landing-link-grow text-[14.5px] font-medium text-mc-text opacity-70 transition hover:opacity-100"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* CTAs (desktop) */}
        <div className="hidden items-center gap-5 md:flex">
          <Link href="/login" className="text-[14.5px] font-semibold text-mc-text hover:opacity-70 transition">
            Entrar
          </Link>
          <Link
            href="/login"
            className="landing-cta-shimmer rounded-mc-base px-4 py-2.5 text-[14px] font-semibold text-white active:scale-[0.98] transition-opacity hover:opacity-90"
            style={{ background: "#F24400" }}
          >
            Começar grátis
          </Link>
        </div>

        {/* Toggle (mobile) */}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-mc-base border border-mc-border bg-mc-surface text-mc-text md:hidden"
          aria-expanded={open}
          aria-controls="nav-v2-mobile-menu"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon size={20} strokeWidth={1.9} /> : <Menu size={20} strokeWidth={1.9} />}
        </button>
      </div>

      {/* Menu mobile */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="nav-v2-mobile-menu"
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-mc-border md:hidden"
          >
            <div className="flex flex-col gap-1 px-8 py-4">
              {NAV_LINKS.map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  onClick={(e) => {
                    handleHashNav(e, href);
                    setOpen(false);
                  }}
                  className="flex min-h-[44px] items-center text-[15px] font-medium text-mc-text"
                >
                  {label}
                </Link>
              ))}
              <div className="mt-2 flex flex-col gap-3 border-t border-mc-border pt-4">
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="flex min-h-[44px] items-center justify-center rounded-mc-base border border-mc-border text-[14.5px] font-semibold text-mc-text"
                >
                  Entrar
                </Link>
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="flex min-h-[44px] items-center justify-center rounded-mc-base text-[14.5px] font-semibold text-white"
                  style={{ background: "#F24400" }}
                >
                  Começar grátis
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function HeroV2() {
  const reducedMotion = useReducedMotion();
  const initial = reducedMotion ? "show" : "hidden";

  return (
    <section className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-14 overflow-hidden px-8 py-20 md:grid-cols-2 md:items-center">
      {/* Mancha de fundo sutil — puramente CSS, já respeita reduced-motion globalmente */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-[-10%] h-[420px] w-[420px] animate-hero-mesh-shift rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(242,68,0,0.35), transparent 70%)" }}
      />

      {/* Left */}
      <div className="relative">
        {/* Badge */}
        <motion.div
          custom={0}
          initial={initial}
          animate="show"
          variants={staggerVariants}
          className="mb-5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
          style={{ background: "#fff4ee", border: "1px solid #f7ddcf" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#F24400" }} />
          <span className="text-[12.5px] font-semibold" style={{ color: "#B22A00" }}>Líder em Inteligência Comercial</span>
        </motion.div>

        <motion.h1
          custom={1}
          initial={initial}
          animate="show"
          variants={staggerVariants}
          className="mb-6 text-[52px] font-extrabold leading-[1.04] tracking-[-0.038em] text-mc-text"
        >
          Atenda, venda e organize com{" "}
          <span style={{ color: "#F24400" }}>IA</span> no WhatsApp.
        </motion.h1>

        <motion.p
          custom={2}
          initial={initial}
          animate="show"
          variants={staggerVariants}
          className="mb-8 text-[18px] leading-[1.6] text-mc-muted"
        >
          Automatize o atendimento, capture leads e feche mais negócios — tudo integrado ao CRM.
        </motion.p>

        {/* CTAs */}
        <motion.div custom={3} initial={initial} animate="show" variants={staggerVariants} className="mb-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="landing-cta-shimmer inline-flex items-center gap-2 rounded-mc-base px-6 py-3.5 text-[15px] font-bold text-white active:scale-[0.98]"
            style={{ background: "#F24400" }}
          >
            Começar grátis
          </Link>
          <Link
            href="#como-funciona"
            onClick={(e) => handleHashNav(e, "#como-funciona")}
            className="inline-flex items-center gap-2 rounded-mc-base border border-mc-border bg-mc-surface px-6 py-3.5 text-[15px] font-bold text-mc-text transition hover:bg-mc-surface-2 active:scale-[0.98]"
          >
            Ver como funciona
          </Link>
        </motion.div>

        {/* Bullet features */}
        <motion.div custom={4} initial={initial} animate="show" variants={staggerVariants} className="flex flex-wrap gap-x-6 gap-y-2">
          {["100% em nuvem", "ChatGPT no WhatsApp", "API Oficial (Meta)", "CRM Kanban + Agenda"].map((f) => (
            <span key={f} className="flex items-center gap-1.5 text-[13.5px] font-medium text-mc-muted">
              <Check size={14} strokeWidth={2} style={{ color: "#00A650" }} />
              {f}
            </span>
          ))}
        </motion.div>
      </div>

      {/* Right — chat mockup */}
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative"
      >
        <div className="overflow-hidden rounded-[18px] border border-mc-border bg-mc-surface">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: "#0E1D29" }}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F24400] text-[14px] font-bold text-white">M</div>
            <div className="flex-1">
              <p className="text-[13.5px] font-semibold text-white">Assistente MyChatCRM</p>
              <p className="text-[11px]" style={{ color: "#5eead4" }}>● online · responde em segundos</p>
            </div>
            <span className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/70">WhatsApp</span>
          </div>

          {/* Chat messages */}
          <div className="flex min-h-[220px] flex-col gap-3 bg-mc-surface-2 p-4">
            <div className="self-start rounded-[14px_14px_14px_4px] bg-mc-surface px-4 py-2.5 text-[13.5px] text-mc-text" style={{ maxWidth: "82%" }}>
              Olá! Vi que vocês têm integração com WhatsApp. Como funciona? 🤔
            </div>
            <div className="self-end rounded-[14px_14px_4px_14px] px-4 py-2.5 text-[13.5px] text-white" style={{ background: "#F24400", maxWidth: "82%" }}>
              Oi! Somos uma plataforma de atendimento e CRM via WhatsApp com IA integrada. Posso mostrar um tour rápido?
            </div>
            <div className="self-start rounded-[14px_14px_14px_4px] bg-mc-surface px-4 py-2.5 text-[13.5px] text-mc-text" style={{ maxWidth: "82%" }}>
              Sim! Preciso muito de algo assim para o meu time comercial 🚀
            </div>
            {/* Typing indicator */}
            <div className="self-end flex gap-1 rounded-full bg-mc-surface px-3.5 py-2.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 rounded-full bg-mc-border animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        </div>

        {/* Floating stats */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="absolute -bottom-4 -left-4 flex items-center gap-2.5 rounded-[12px] bg-mc-surface px-3.5 py-2.5 shadow-none border border-mc-border"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#ecfdf3" }}>
            <span style={{ color: "#067a3c", fontSize: "16px" }}>📈</span>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-mc-text">+42% conversão</p>
            <p className="text-[11px] text-mc-muted">média entre clientes</p>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trust bar
// ---------------------------------------------------------------------------

type TrustStat =
  | { kind: "count"; target: number; prefix?: string; suffix?: string; thousands?: boolean; label: string }
  | { kind: "static"; value: string; label: string };

const TRUST_STATS: TrustStat[] = [
  { kind: "count", target: 1200, prefix: "+", thousands: true, label: "clientes ativos" },
  { kind: "count", target: 98, suffix: "%", label: "satisfação" },
  { kind: "static", value: "24/7", label: "IA operando" },
  { kind: "count", target: 3, prefix: "+", suffix: "M", label: "mensagens/mês" },
];

function TrustStatValue({
  target,
  prefix = "",
  suffix = "",
  thousands,
  inView,
  reducedMotion,
}: {
  target: number;
  prefix?: string;
  suffix?: string;
  thousands?: boolean;
  inView: boolean;
  reducedMotion: boolean;
}) {
  const value = useCountUp(target, { inView, reducedMotion });
  const rounded = Math.round(value);
  const display = thousands ? rounded.toLocaleString("pt-BR") : rounded;
  return (
    <p className="text-[26px] font-extrabold tracking-tight text-mc-text">
      {prefix}
      {display}
      {suffix}
    </p>
  );
}

function TrustBarV2() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reducedMotion = useReducedMotion();

  return (
    <div ref={ref} className="border-y border-mc-border bg-mc-surface">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 px-8 py-6 md:grid-cols-4">
        {TRUST_STATS.map((s, i) => (
          <div key={i} className={cn("flex flex-col items-center py-4 text-center", i < TRUST_STATS.length - 1 && "border-r border-mc-border")}>
            {s.kind === "static" ? (
              <p className="text-[26px] font-extrabold tracking-tight text-mc-text">{s.value}</p>
            ) : (
              <TrustStatValue
                target={s.target}
                prefix={s.prefix}
                suffix={s.suffix}
                thousands={s.thousands}
                inView={inView}
                reducedMotion={!!reducedMotion}
              />
            )}
            <p className="mt-1 text-[12.5px] font-medium text-mc-muted">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const FEATURES = [
  { icon: MessageCircle, title: "Atendimento multiagente", desc: "Vários atendentes na mesma conta, com controle de filas e histórico centralizado." },
  { icon: Zap, title: "IA no WhatsApp", desc: "ChatGPT treinado com o contexto do seu negócio responde clientes em segundos." },
  { icon: Users, title: "CRM Kanban integrado", desc: "Arraste leads entre etapas do funil diretamente dentro da conversa." },
  { icon: BarChart2, title: "Relatórios em tempo real", desc: "Volume de mensagens, taxa de conversão e performance da equipa num painel único." },
  { icon: RefreshCw, title: "Integrações nativas", desc: "Webhooks, Zapier, Make, n8n — conecte ao seu stack sem código." },
  { icon: Shield, title: "API Oficial Meta", desc: "Número verificado, alta disponibilidade, sem risco de banimento de contas." },
] as const;

function FeaturesV2() {
  const reducedMotion = useReducedMotion();

  return (
    <section id="recursos" className="mx-auto max-w-[1200px] scroll-mt-[88px] px-8 py-24">
      <div className="mx-auto mb-14 max-w-[660px] text-center">
        <p className="mb-3.5 text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "#F24400" }}>
          Recursos
        </p>
        <h2 className="mb-4 text-[40px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text">
          Tudo para vender mais no WhatsApp
        </h2>
        <p className="text-[17px] leading-[1.6] text-mc-muted">
          Atenda melhor, converta mais e mantenha o time alinhado — em um só lugar.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, desc }, i) => (
          <motion.div
            key={title}
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            whileHover={reducedMotion ? undefined : { y: -4 }}
            className="rounded-mc-base border border-mc-border bg-mc-surface p-7 transition-colors hover:border-[rgba(242,68,0,0.35)] hover:bg-mc-surface-2"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: "#fff4ee" }}>
              <Icon size={20} strokeWidth={1.9} style={{ color: "#F24400" }} />
            </div>
            <p className="mb-2 text-[17px] font-bold tracking-tight text-mc-text">{title}</p>
            <p className="text-[14px] leading-[1.55] text-mc-muted">{desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works (dark section)
// ---------------------------------------------------------------------------

const STEPS = [
  { n: "01", title: "Conecte seu WhatsApp", desc: "Integração via API Oficial da Meta, com segurança e conformidade." },
  { n: "02", title: "Treine a IA com especialistas", desc: "Alimentamos o assistente com as informações do seu negócio e segmento." },
  { n: "03", title: "Atenda e venda em piloto automático", desc: "A IA qualifica, responde e passa para o humano no momento certo." },
] as const;

function HowItWorksV2() {
  const reducedMotion = useReducedMotion();

  return (
    <section id="como-funciona" className="scroll-mt-[88px]" style={{ background: "#0E1D29" }}>
      <div className="mx-auto max-w-[1200px] px-8 py-24">
        <div className="mx-auto mb-14 max-w-[640px] text-center">
          <p className="mb-3.5 text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "#ff9b73" }}>
            Como funciona
          </p>
          <h2 className="mb-4 text-[40px] font-extrabold leading-[1.1] tracking-[-0.03em] text-white">
            Três passos para automatizar suas vendas
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {STEPS.map(({ n, title, desc }, i) => (
            <motion.div
              key={n}
              initial={reducedMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: i * 0.08, duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[16px] p-7"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
            >
              <p className="mb-4 text-[13px] font-bold" style={{ color: "#F24400" }}>{n}</p>
              <p className="mb-2.5 text-[19px] font-bold leading-tight tracking-tight text-white">{title}</p>
              <p className="text-[14.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>{desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

type BillingCycle = "monthly" | "annual";

const PLANS = [
  {
    slug: "solo",
    name: "Solo",
    tagline: "Para autônomos e freelancers",
    priceMonthly: 97,
    features: ["1 número WhatsApp", "1 agente de IA", "500 leads/mês", "CRM Kanban", "Suporte via chat"],
    cta: "Começar com Solo",
    highlight: false,
  },
  {
    slug: "equipa",
    name: "Equipa",
    tagline: "Para equipes em crescimento",
    priceMonthly: 497,
    features: ["3 números WhatsApp", "Agentes ilimitados", "5.000 leads/mês", "CRM + Agenda Google", "Disparo em massa", "Suporte prioritário"],
    cta: "Começar com Equipa",
    highlight: true,
  },
  {
    slug: "escala",
    name: "Escala",
    tagline: "Para operações de alto volume",
    priceMonthly: 997,
    features: ["10 números WhatsApp", "Agentes ilimitados", "Leads ilimitados", "CRM + Analytics avançado", "API + Webhooks", "Gerente de sucesso dedicado"],
    cta: "Começar com Escala",
    highlight: false,
  },
] as const;

function PricingV2() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const reducedMotion = useReducedMotion();

  return (
    <section id="planos" className="mx-auto max-w-[1200px] scroll-mt-[88px] px-8 py-24">
      <div className="mx-auto mb-14 max-w-[640px] text-center">
        <p className="mb-3.5 text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "#F24400" }}>
          Planos
        </p>
        <h2 className="mb-4 text-[40px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text">
          Escolha o plano ideal
        </h2>
        <p className="mb-8 text-[17px] leading-[1.6] text-mc-muted">
          Comece com 7 dias de teste grátis. Cancele quando quiser.
        </p>

        {/* Toggle */}
        <div className="inline-flex items-center rounded-full bg-mc-surface-2 p-1">
          {(["monthly", "annual"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={cn(
                "rounded-full px-5 py-2.5 text-[13px] font-semibold transition-colors",
                cycle === c ? "bg-mc-surface text-mc-text border border-mc-border" : "text-mc-muted",
              )}
            >
              {c === "monthly" ? "Mensal" : "Anual"}
              {c === "annual" && (
                <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold text-white" style={{ background: "#00A650" }}>
                  −20%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {PLANS.map((plan, i) => {
          const price = Math.round(planEffectiveMonthlyBRL(plan.priceMonthly, cycle));
          return (
            <motion.div
              key={plan.slug}
              initial={reducedMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: i * 0.08, duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
              whileHover={reducedMotion ? undefined : { y: -4 }}
              className={cn(
                "flex flex-col rounded-mc-base border p-7 transition-colors",
                plan.highlight
                  ? "border-[#F24400] bg-mc-surface"
                  : "border-mc-border bg-mc-surface hover:border-[rgba(242,68,0,0.35)]",
              )}
            >
              {plan.highlight && (
                <div className="mb-4 inline-flex items-center self-start rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: "#F24400" }}>
                  Mais popular
                </div>
              )}
              <p className="mb-1 text-[20px] font-extrabold tracking-tight text-mc-text">{plan.name}</p>
              <p className="mb-5 text-[13.5px] text-mc-muted">{plan.tagline}</p>

              <div className="mb-6 min-h-[46px] overflow-hidden">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={cycle}
                    initial={reducedMotion ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? undefined : { opacity: 0, y: 6 }}
                    transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="text-[38px] font-extrabold leading-none tracking-tight text-mc-text"
                  >
                    R${price}
                  </motion.span>
                </AnimatePresence>
                <span className="ml-1 text-[14px] text-mc-muted">/mês</span>
                {cycle === "annual" && (
                  <p className="mt-1 text-[12px] text-mc-muted">cobrado anualmente</p>
                )}
              </div>

              <ul className="mb-8 flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[14px] text-mc-text">
                    <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" style={{ color: "#00A650" }} />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={`/login?plan=${plan.slug}&ciclo=${cycle}`}
                className={cn(
                  "block rounded-mc-base py-3.5 text-center text-[14.5px] font-bold transition active:scale-[0.98]",
                  plan.highlight
                    ? "text-white"
                    : "border border-mc-border bg-mc-surface-2 text-mc-text hover:bg-mc-border",
                )}
                style={plan.highlight ? { background: "#F24400" } : undefined}
              >
                {plan.cta}
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Enterprise CTA */}
      <div className="mt-6 flex items-center justify-between rounded-mc-base border border-mc-border bg-mc-surface p-6 md:px-8">
        <div>
          <p className="text-[17px] font-bold text-mc-text">Enterprise</p>
          <p className="mt-0.5 text-[14px] text-mc-muted">Volumes altos, SLA dedicado e contrato personalizado.</p>
        </div>
        <a href="mailto:comercial@mychatcrm.com.br" data-lead-gate="contact" className="shrink-0 rounded-mc-base border border-mc-border bg-mc-surface-2 px-5 py-2.5 text-[14px] font-semibold text-mc-text hover:bg-mc-border transition active:scale-[0.98]">
          Falar com comercial
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQ_ITEMS = [
  { q: "Preciso ter número de WhatsApp Business?", a: "Sim. Usamos a API Oficial da Meta, que requer um número dedicado ao negócio. Você pode usar um número existente após verificação." },
  { q: "Quanto tempo leva para configurar?", a: "Em geral, menos de 48h após a aprovação da API pela Meta. Nossa equipa acompanha todo o processo de ativação." },
  { q: "A IA responde em português do Brasil?", a: "Sim, de forma nativa. Você define o tom, vocabulário e as regras de negócio — a IA aprende com o contexto da sua empresa." },
  { q: "Posso cancelar a qualquer momento?", a: "Sim, sem multa ou carência. Planos mensais são cancelados no final do período vigente." },
  { q: "O que acontece se eu passar do limite de leads?", a: "Você será notificado antes de atingir o limite. É possível fazer upgrade de plano ou adquirir pacotes adicionais." },
] as const;

function FAQV2() {
  const [open, setOpen] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();

  return (
    <section className="mx-auto max-w-[760px] px-8 py-24">
      <h2 className="mb-12 text-center text-[40px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text">
        Perguntas frequentes
      </h2>

      <div className="space-y-2">
        {FAQ_ITEMS.map(({ q, a }, i) => (
          <div key={i} className="rounded-mc-base border border-mc-border bg-mc-surface">
            <button
              type="button"
              id={`faq-trigger-${i}`}
              className="flex w-full items-center justify-between px-6 py-4 text-left"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              aria-controls={`faq-panel-${i}`}
            >
              <span className="pr-4 text-[16px] font-semibold text-mc-text">{q}</span>
              {open === i ? (
                <ChevronUp size={18} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
              ) : (
                <ChevronDown size={18} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
              )}
            </button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.div
                  key="content"
                  id={`faq-panel-${i}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${i}`}
                  initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="border-t border-mc-border px-6 pb-5 pt-4 text-[15px] leading-[1.65] text-mc-muted">
                    {a}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA Banner
// ---------------------------------------------------------------------------

function CtaBannerV2() {
  const reducedMotion = useReducedMotion();

  return (
    <section className="mx-auto max-w-[1200px] px-8 pb-24">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden rounded-mc-base p-12 text-center"
        style={{ background: "#0E1D29" }}
      >
        <h2 className="mb-5 text-[42px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">
          Comece hoje, veja resultados em 7 dias
        </h2>
        <p className="mx-auto mb-8 max-w-[520px] text-[17px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          Mais de 1.200 empresas já usam o MyChatCRM para fechar negócios no WhatsApp com IA.
        </p>
        <Link
          href="/login"
          className="landing-cta-shimmer inline-flex items-center gap-2 rounded-mc-base px-8 py-4 text-[16px] font-bold text-white active:scale-[0.98]"
          style={{ background: "#F24400" }}
        >
          Criar conta gratuita
        </Link>
        <p className="mt-5 text-[13px]" style={{ color: "#64748b" }}>
          7 dias grátis · Sem cartão de crédito · Cancele quando quiser
        </p>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

type SocialPlatform = "instagram" | "tiktok" | "youtube" | "x" | "linkedin" | "whatsapp";

const SOCIAL_ITEMS: { platform: SocialPlatform; href: string; label: string }[] = [
  { platform: "instagram", href: SOCIAL_LINKS.instagram, label: "Instagram" },
  { platform: "tiktok", href: SOCIAL_LINKS.tiktok, label: "TikTok" },
  { platform: "youtube", href: SOCIAL_LINKS.youtube, label: "YouTube" },
  { platform: "x", href: SOCIAL_LINKS.x, label: "X" },
  { platform: "linkedin", href: SOCIAL_LINKS.linkedin, label: "LinkedIn" },
  { platform: "whatsapp", href: whatsappHandoffHref(), label: "WhatsApp" },
];

function SocialGlyph({ platform }: { platform: SocialPlatform }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (platform) {
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14.5 3v10.8a3.5 3.5 0 1 1-3.5-3.5c.33 0 .66.04 1 .13" />
          <path d="M14.5 3.2a5 5 0 0 0 5 5" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="19" height="12" rx="4" />
          <path d="M10.3 9.6l5 2.4-5 2.4z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <circle cx="8" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
          <path d="M8 11v6" />
          <path d="M12 17v-4a2 2 0 0 1 4 0v4" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L4 20l1.1-4.6A8.4 8.4 0 1 1 21 11.5z" />
        </svg>
      );
  }
}

function FooterV2() {
  return (
    <footer className="border-t border-mc-border bg-mc-surface">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-5 px-8 py-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-[8px]" style={{ background: "#F24400" }}>
            <div className="h-2.5 w-2.5 rounded-[50%_50%_50%_1px] border-[1.5px] border-white" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-mc-text">MyChatCRM</span>
        </div>

        <div className="flex flex-wrap gap-6">
          {[
            ["Planos", "#planos"],
            ["Blog", "/blog"],
            ["Termos", "/termos-de-uso"],
            ["Privacidade", "/politica-de-privacidade"],
          ].map(([label, href]) => (
            <Link
              key={label}
              href={href}
              onClick={(e) => handleHashNav(e, href)}
              className="landing-link-grow text-[13.5px] font-medium text-mc-muted transition hover:text-mc-text"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {SOCIAL_ITEMS.map((s) => (
            <a
              key={s.platform}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              className="flex h-8 w-8 items-center justify-center rounded-full text-mc-muted transition hover:scale-110 hover:text-[#F24400]"
            >
              <SocialGlyph platform={s.platform} />
            </a>
          ))}
        </div>

        <p className="text-[13px] text-mc-muted">© {new Date().getFullYear()} MyChatCRM · Todos os direitos reservados</p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Composed Landing V2
// ---------------------------------------------------------------------------

export function LandingV2() {
  // Cobre chegar na home já com uma âncora na URL (ex.: clicou em
  // "Recursos" a partir do /blog, que navega pra "/#recursos") — nesse
  // caso não há clique pra interceptar, só o carregamento da página.
  useEffect(() => {
    if (!window.location.hash) return;
    const el = document.querySelector(window.location.hash);
    if (!el) return;
    // Espera o primeiro paint assentar antes de rolar.
    const id = requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "start" }));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="min-h-dvh bg-mc-bg">
      <NavV2 />
      <main>
        <HeroV2 />
        <TrustBarV2 />
        <FeaturesV2 />
        <HowItWorksV2 />
        <PricingV2 />
        <FAQV2 />
        <CtaBannerV2 />
      </main>
      <FooterV2 />
    </div>
  );
}
