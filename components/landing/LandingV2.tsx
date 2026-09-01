"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion, useInView } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Users,
  RefreshCw,
  Shield,
  Menu,
  X as CloseIcon,
  Clock,
  Calendar,
  Send,
  Link2,
  ArrowRightLeft,
  Flag,
  Bot,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SALES_PLANS, PLAN_ANNUAL_DISCOUNT_PERCENT, planEffectiveMonthlyBRL } from "@/lib/plans";
import { SOCIAL_LINKS } from "@/lib/social-links";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";

// ---------------------------------------------------------------------------
// Identidade — manchetes em Manrope (já carregada em app/[locale]/layout.tsx,
// mas o CSS global do site força Inter nos headings; sobrescrevemos só aqui,
// via estilo inline, sem tocar no `.brand-marketing` global).
// ---------------------------------------------------------------------------

const FONT_DISPLAY = "var(--font-brand-display), var(--font-brand-body), var(--font-inter), sans-serif";

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

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

const NAV_LINKS = [
  ["Recursos", "#recursos"],
  ["Como decide", "#como-decide"],
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
          <span className="text-[18px] font-bold tracking-tight text-mc-text" style={{ fontFamily: FONT_DISPLAY }}>
            MyChatCRM
          </span>
        </div>

        {/* Links */}
        <div className="hidden items-center gap-8 lg:flex">
          {NAV_LINKS.map(([label, href]) => (
            <Link
              key={label}
              href={href}
              onClick={(e) => handleHashNav(e, href)}
              className="landing-link-grow whitespace-nowrap text-[14px] font-medium text-mc-text opacity-70 transition hover:opacity-100"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* CTAs (desktop) */}
        <div className="hidden items-center gap-5 lg:flex">
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
          className="inline-flex h-10 w-10 items-center justify-center rounded-mc-base border border-mc-border bg-mc-surface text-mc-text lg:hidden"
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
            className="overflow-hidden border-t border-mc-border lg:hidden"
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
// Hero — vitrine com carrossel de "momentos do produto" + prévia do painel
// ---------------------------------------------------------------------------

function ShowcaseChat() {
  return (
    <div className="flex min-h-[220px] flex-col gap-3">
      <div className="self-start rounded-[14px_14px_14px_4px] bg-mc-surface px-4 py-2.5 text-[13.5px] text-mc-text" style={{ maxWidth: "82%" }}>
        Olá! Vi que vocês têm integração com WhatsApp. Como funciona? 🤔
      </div>
      <div className="self-end rounded-[14px_14px_4px_14px] px-4 py-2.5 text-[13.5px] text-white" style={{ background: "#F24400", maxWidth: "82%" }}>
        Oi! Sou o assistente da MyChatCRM — atendo, agendo e organizo tudo no CRM enquanto a gente conversa. Posso te mostrar um exemplo rápido?
      </div>
      <div className="self-start rounded-[14px_14px_14px_4px] bg-mc-surface px-4 py-2.5 text-[13.5px] text-mc-text" style={{ maxWidth: "82%" }}>
        Sim! Preciso muito de algo assim para o meu time comercial 🚀
      </div>
      <div className="self-end flex gap-1 rounded-full bg-mc-surface px-3.5 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 rounded-full bg-mc-border animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  );
}

function ShowcaseAgenda() {
  return (
    <div className="flex min-h-[220px] flex-col gap-3">
      <div className="self-start rounded-[14px_14px_14px_4px] bg-mc-surface px-4 py-2.5 text-[13.5px] text-mc-text" style={{ maxWidth: "82%" }}>
        Consigo marcar uma visita pra quinta-feira à tarde?
      </div>
      <div className="self-end rounded-[14px_14px_4px_14px] p-1 text-[13.5px] text-white" style={{ background: "#F24400", maxWidth: "88%" }}>
        <div className="rounded-[10px] bg-white/10 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">📅 Consulta confirmada</p>
          <p className="mt-1 text-[13px] font-medium text-white">Quinta-feira, 14h</p>
          <p className="mt-0.5 text-[11.5px] text-white/75">Lembrete automático enviado 1h antes</p>
        </div>
      </div>
      <div className="self-start rounded-[14px_14px_14px_4px] bg-mc-surface px-4 py-2.5 text-[13.5px] text-mc-text" style={{ maxWidth: "82%" }}>
        Perfeito, muito obrigado! 🙌
      </div>
    </div>
  );
}

function ShowcaseKanban() {
  const reducedMotion = useReducedMotion();
  const columns = [
    { title: "Novo", cards: ["Marina S."] },
    { title: "Em conversa", cards: ["Diego R.", "Paulo M."] },
    { title: "Fechado", cards: ["Camila F."] },
  ];
  return (
    <div className="min-h-[220px]">
      <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-mc-muted">CRM Kanban — exemplo</p>
      <div className="grid grid-cols-3 gap-2.5">
        {columns.map((col) => (
          <div key={col.title} className="rounded-[10px] border border-mc-border bg-mc-surface p-2">
            <p className="mb-2 text-[10px] font-semibold text-mc-muted">{col.title}</p>
            <div className="flex flex-col gap-1.5">
              {col.cards.map((name) => (
                <div key={name} className="rounded-[8px] border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-[10.5px] font-medium text-mc-text">
                  {name}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <motion.span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "#F24400" }}
          animate={reducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <p className="text-[11px] text-mc-muted">card avança sozinho quando a IA qualifica o lead</p>
      </div>
    </div>
  );
}

const SHOWCASE_PANELS = ["chat", "agenda", "kanban"] as const;
type ShowcasePanel = (typeof SHOWCASE_PANELS)[number];

function HeroShowcase() {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % SHOWCASE_PANELS.length), 4200);
    return () => clearInterval(id);
  }, [reducedMotion]);

  const panel: ShowcasePanel = SHOWCASE_PANELS[index];

  return (
    <div
      className="overflow-hidden rounded-[18px] border border-mc-border bg-mc-surface"
      style={{ boxShadow: "0 30px 80px -30px rgba(14,29,41,0.35)" }}
    >
      <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: "#0E1D29" }}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F24400] text-[14px] font-bold text-white">M</div>
        <div className="flex-1">
          <p className="text-[13.5px] font-semibold text-white">Assistente MyChatCRM</p>
          <p className="text-[11px]" style={{ color: "#5eead4" }}>● online · responde em segundos</p>
        </div>
        <span className="rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/70">WhatsApp</span>
      </div>

      <div className="relative bg-mc-surface-2 p-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={panel}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reducedMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {panel === "chat" && <ShowcaseChat />}
            {panel === "agenda" && <ShowcaseAgenda />}
            {panel === "kanban" && <ShowcaseKanban />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-center gap-1.5 border-t border-mc-border bg-mc-surface py-3">
        {SHOWCASE_PANELS.map((p, i) => (
          <button
            key={p}
            type="button"
            aria-label={`Ver exemplo ${i + 1} de 3`}
            onClick={() => setIndex(i)}
            className={cn("h-1.5 rounded-full transition-all", i === index ? "w-5" : "w-1.5 bg-mc-border")}
            style={i === index ? { background: "#F24400" } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function MiniDashboardPreview() {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="absolute -bottom-7 -left-7 hidden w-[196px] rounded-[14px] border border-mc-border bg-mc-surface p-3.5 sm:block"
      style={{ boxShadow: "0 20px 50px -22px rgba(14,29,41,0.35)" }}
    >
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-mc-muted">Prévia do seu painel</p>
      <div className="flex items-end gap-3">
        <svg width="60" height="60" viewBox="0 0 72 72" aria-hidden className="shrink-0">
          <circle cx="36" cy="36" r="29" fill="none" stroke="var(--border)" strokeWidth="7" />
          <circle
            cx="36"
            cy="36"
            r="29"
            fill="none"
            stroke="#F24400"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray="182.2"
            strokeDashoffset="62"
            transform="rotate(-90 36 36)"
          />
        </svg>
        <div className="flex flex-1 items-end gap-1.5" style={{ height: 40 }}>
          {[16, 28, 20, 38, 26].map((h, i) => (
            <div key={i} className="flex-1 rounded-t-sm" style={{ height: h, background: i === 3 ? "#F24400" : "rgba(242,68,0,0.22)" }} />
          ))}
        </div>
      </div>
      <p className="mt-2.5 text-[10.5px] leading-snug text-mc-muted">Conversas, automação e follow-ups — tudo num painel só. (ilustração)</p>
    </motion.div>
  );
}

function HeroV2() {
  const reducedMotion = useReducedMotion();
  const initial = reducedMotion ? "show" : "hidden";

  return (
    <section className="relative overflow-hidden bg-gradient-hero">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-[-8%] h-[440px] w-[440px] animate-hero-mesh-shift rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(242,68,0,0.35), transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[-6%] top-1/3 h-[300px] w-[300px] animate-landing-float-slower rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(14,29,41,0.5), transparent 70%)" }}
      />

      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-16 px-8 py-20 md:grid-cols-2 md:items-center md:py-28">
        {/* Left */}
        <div className="relative">
          <motion.div
            custom={0}
            initial={initial}
            animate="show"
            variants={staggerVariants}
            className="mb-5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{ background: "#fff4ee", border: "1px solid #f7ddcf" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#F24400" }} />
            <span className="text-[12.5px] font-semibold" style={{ color: "#B22A00" }}>
              Feito para vender no WhatsApp
            </span>
          </motion.div>

          <motion.h1
            custom={1}
            initial={initial}
            animate="show"
            variants={staggerVariants}
            className="mb-6 text-[44px] font-extrabold leading-[1.05] tracking-[-0.03em] text-mc-text sm:text-[54px]"
            style={{ fontFamily: FONT_DISPLAY }}
          >
            O comercial que{" "}
            <span style={{ color: "#F24400" }}>nunca dorme</span>, nunca esquece um follow-up.
          </motion.h1>

          <motion.p custom={2} initial={initial} animate="show" variants={staggerVariants} className="mb-8 text-[17px] leading-[1.6] text-mc-muted">
            MyChatCRM entende o contexto da conversa, agenda compromissos, transfere pra um humano na hora
            certa e organiza tudo no CRM — direto no WhatsApp, com a API Oficial da Meta.
          </motion.p>

          <motion.div custom={3} initial={initial} animate="show" variants={staggerVariants} className="mb-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="landing-cta-shimmer inline-flex items-center gap-2 rounded-mc-base px-6 py-3.5 text-[15px] font-bold text-white active:scale-[0.98]"
              style={{ background: "#F24400", boxShadow: "0 16px 36px -14px rgba(242,68,0,0.55)" }}
            >
              Começar grátis
            </Link>
            <Link
              href="#como-decide"
              onClick={(e) => handleHashNav(e, "#como-decide")}
              className="inline-flex items-center gap-2 rounded-mc-base border border-mc-border bg-mc-surface px-6 py-3.5 text-[15px] font-bold text-mc-text transition hover:bg-mc-surface-2 active:scale-[0.98]"
            >
              Ver como o agente pensa
            </Link>
          </motion.div>

          <motion.div custom={4} initial={initial} animate="show" variants={staggerVariants} className="flex flex-wrap gap-x-6 gap-y-2">
            {["100% em nuvem", "IA com memória de contexto", "API Oficial (Meta)", "CRM Kanban + Agenda"].map((f) => (
              <span key={f} className="flex items-center gap-1.5 text-[13.5px] font-medium text-mc-muted">
                <Check size={14} strokeWidth={2} style={{ color: "#00A650" }} />
                {f}
              </span>
            ))}
          </motion.div>
        </div>

        {/* Right — vitrine */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative pb-10 sm:pb-0"
        >
          <HeroShowcase />
          <MiniDashboardPreview />
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Faixa de capacidades — reais, sem número inventado
// ---------------------------------------------------------------------------

const CAPABILITY_BADGES = [
  { icon: Shield, label: "API Oficial da Meta" },
  { icon: Bot, label: "Vários agentes por conta" },
  { icon: Mic, label: "Respostas em áudio" },
  { icon: Calendar, label: "Agenda com lembretes automáticos" },
  { icon: Link2, label: "Catálogo externo em minutos" },
] as const;

function CapabilityStripV2() {
  return (
    <div className="border-y border-mc-border bg-mc-surface">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-9 gap-y-4 px-8 py-6">
        {CAPABILITY_BADGES.map(({ icon: Icon, label }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
            className="flex items-center gap-2 text-[13px] font-medium text-mc-muted"
          >
            <Icon size={16} strokeWidth={1.9} style={{ color: "#F24400" }} />
            {label}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Como o agente decide" — diagrama de raciocínio (peça exclusiva)
// ---------------------------------------------------------------------------

const AGENT_OUTCOMES = [
  { icon: MessageCircle, title: "Responde", desc: "Com o tom e as regras que você configurou" },
  { icon: Calendar, title: "Consulta ou marca agenda", desc: "Direto na conversa, sem sair do WhatsApp" },
  { icon: ArrowRightLeft, title: "Transfere pra um humano", desc: "Por palavra-chave ou critério seu" },
  { icon: Link2, title: "Consulta uma API externa", desc: "Catálogo, estoque ou qualquer sistema seu" },
  { icon: Flag, title: "Marca como perdido", desc: "Só quando você escreve o critério — nunca no achismo" },
] as const;

function HowAgentDecidesV2() {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const grow = reducedMotion ? undefined : { scaleY: inView ? 1 : 0 };
  const growX = reducedMotion ? undefined : { scaleX: inView ? 1 : 0 };

  return (
    <section id="como-decide" className="mx-auto max-w-[1100px] scroll-mt-[88px] px-8 py-24">
      <div className="mx-auto mb-16 max-w-[640px] text-center">
        <p className="mb-3.5 text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "#F24400" }}>
          Por dentro do agente
        </p>
        <h2
          className="mb-4 text-[36px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text sm:text-[40px]"
          style={{ fontFamily: FONT_DISPLAY }}
        >
          Cada mensagem passa por um raciocínio — não um roteiro fixo.
        </h2>
        <p className="text-[17px] leading-[1.6] text-mc-muted">
          É literalmente assim que o motor de IA do MyChatCRM decide o que fazer a cada mensagem.
        </p>
      </div>

      <div ref={ref} className="relative">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={inView || reducedMotion ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4 }}
          className="mx-auto w-fit rounded-mc-base border border-mc-border bg-mc-surface px-5 py-3 text-center text-[14px] font-semibold text-mc-text"
        >
          Cliente manda mensagem(ns) no WhatsApp
        </motion.div>

        <motion.div className="mx-auto h-8 w-px origin-top bg-mc-border" initial={{ scaleY: reducedMotion ? 1 : 0 }} animate={grow} transition={{ duration: 0.35, delay: 0.15 }} />

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={inView || reducedMotion ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="mx-auto w-fit rounded-mc-base border px-5 py-3 text-center text-[14px] font-semibold"
          style={{ borderColor: "#F24400", background: "#fff4ee", color: "#B22A00" }}
        >
          <div className="flex items-center gap-2">
            <Clock size={16} strokeWidth={2} />
            SmartWait agrupa tudo antes de responder
          </div>
        </motion.div>

        <motion.div className="mx-auto h-8 w-px origin-top bg-mc-border" initial={{ scaleY: reducedMotion ? 1 : 0 }} animate={grow} transition={{ duration: 0.35, delay: 0.4 }} />

        <motion.div
          className="mx-auto hidden h-px max-w-[820px] origin-center bg-mc-border lg:block"
          initial={{ scaleX: reducedMotion ? 1 : 0 }}
          animate={growX}
          transition={{ duration: 0.5, delay: 0.5 }}
        />

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {AGENT_OUTCOMES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={reducedMotion ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: 0.55 + i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center text-center"
            >
              <div className="mb-2 hidden h-6 w-px bg-mc-border lg:block" />
              <div className="w-full rounded-mc-base border border-mc-border bg-mc-surface p-4">
                <div className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: "#fff4ee" }}>
                  <Icon size={17} strokeWidth={1.9} style={{ color: "#F24400" }} />
                </div>
                <p className="mb-1 text-[13.5px] font-bold text-mc-text">{title}</p>
                <p className="text-[12px] leading-[1.5] text-mc-muted">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recursos — grid bento (cards de texto + 2 painéis ilustrados)
// ---------------------------------------------------------------------------

function CrmMiniDiagram() {
  const reducedMotion = useReducedMotion();
  const columns = [
    { title: "Novo", cards: ["Marina S."] },
    { title: "Em conversa", cards: ["Diego R."] },
    { title: "Fechado", cards: ["Camila F.", "Ricardo A."] },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {columns.map((col) => (
        <div key={col.title} className="rounded-[10px] border border-mc-border bg-mc-surface-2 p-2">
          <p className="mb-2 text-[9.5px] font-semibold uppercase text-mc-muted">{col.title}</p>
          <div className="flex flex-col gap-1.5">
            {col.cards.map((name) => (
              <div key={name} className="rounded-[7px] border border-mc-border bg-mc-surface px-2 py-1.5 text-[10px] font-medium text-mc-text">
                {name}
              </div>
            ))}
          </div>
        </div>
      ))}
      <motion.div
        aria-hidden
        className="col-span-3 mx-auto mt-1 h-1 w-10 rounded-full"
        style={{ background: "#F24400" }}
        animate={reducedMotion ? undefined : { opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function FollowUpMiniDiagram() {
  const steps = [
    { day: "Dia 0", label: "Mensagem enviada" },
    { day: "Dia 1", label: "Lembrete sutil" },
    { day: "Dia 3", label: "Última tentativa" },
  ];
  return (
    <div className="flex items-start justify-between gap-1">
      {steps.map((s, i) => (
        <div key={s.day} className="flex flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <div className={cn("h-px flex-1", i === 0 && "opacity-0")} style={{ background: "var(--border)" }} />
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: "#fff4ee" }}>
              <MessageCircle size={12} strokeWidth={2} style={{ color: "#F24400" }} />
            </div>
            <div className={cn("h-px flex-1", i === steps.length - 1 && "opacity-0")} style={{ background: "var(--border)" }} />
          </div>
          <p className="mt-2 text-[10px] font-bold text-mc-text">{s.day}</p>
          <p className="text-[9.5px] leading-tight text-mc-muted">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

type FeatureItem = {
  icon: typeof MessageCircle;
  title: string;
  desc: string;
  wide?: boolean;
  diagram?: () => React.ReactElement;
};

const FEATURES: FeatureItem[] = [
  { icon: Clock, title: "Atendimento com memória", desc: "SmartWait agrupa mensagens em rajada antes de responder, e o agente lembra o contexto da conversa inteira." },
  { icon: Users, title: "CRM Kanban", desc: "Arraste leads entre etapas do funil sem sair da conversa — cada card carrega histórico, origem e responsável.", wide: true, diagram: () => <CrmMiniDiagram /> },
  { icon: Calendar, title: "Agenda integrada", desc: "O agente consulta e marca direto pelo WhatsApp, com lembretes automáticos pro cliente." },
  { icon: Send, title: "Disparos em massa", desc: "Campanhas autorizadas pra sua base, com um agente cuidando das respostas em tempo real." },
  { icon: Link2, title: "Catálogo externo", desc: "Cole o link e uma ou duas chaves — o catálogo sincroniza sozinho e o agente já responde com base nele." },
  { icon: RefreshCw, title: "Follow-up que não desiste cedo", desc: "Tentativas espaçadas e tom configurável — para sozinho assim que o lead responde ou vira tarefa manual.", wide: true, diagram: () => <FollowUpMiniDiagram /> },
  { icon: ArrowRightLeft, title: "Handoff pro humano", desc: "Palavras-chave ou critério seu decidem quando transferir — sem o cliente perceber a troca." },
];

function FeaturesV2() {
  const reducedMotion = useReducedMotion();

  return (
    <section id="recursos" className="mx-auto max-w-[1200px] scroll-mt-[88px] px-8 py-24">
      <div className="mx-auto mb-14 max-w-[660px] text-center">
        <p className="mb-3.5 text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "#F24400" }}>
          Recursos
        </p>
        <h2 className="mb-4 text-[36px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text sm:text-[40px]" style={{ fontFamily: FONT_DISPLAY }}>
          Tudo para vender mais no WhatsApp
        </h2>
        <p className="text-[17px] leading-[1.6] text-mc-muted">
          Atenda melhor, converta mais e mantenha o time alinhado — em um só lugar.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, desc, wide, diagram: Diagram }, i) => (
          <motion.div
            key={title}
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ delay: i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            whileHover={reducedMotion ? undefined : { y: -4 }}
            className={cn(
              "rounded-mc-base border border-mc-border bg-mc-surface p-7 transition-colors hover:border-[rgba(242,68,0,0.35)] hover:bg-mc-surface-2",
              wide && "lg:col-span-2",
            )}
          >
            <div className={cn(wide ? "flex flex-col gap-6 sm:flex-row sm:items-center" : undefined)}>
              <div className={cn(wide && "flex-1")}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: "#fff4ee" }}>
                  <Icon size={20} strokeWidth={1.9} style={{ color: "#F24400" }} />
                </div>
                <p className="mb-2 text-[17px] font-bold tracking-tight text-mc-text">{title}</p>
                <p className="text-[14px] leading-[1.55] text-mc-muted">{desc}</p>
              </div>
              {Diagram && (
                <div className="mt-5 rounded-[12px] border border-mc-border bg-mc-surface-2/60 p-4 sm:mt-0 sm:w-[260px] sm:shrink-0">
                  <Diagram />
                </div>
              )}
            </div>
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
          <h2 className="mb-4 text-[36px] font-extrabold leading-[1.1] tracking-[-0.03em] text-white sm:text-[40px]" style={{ fontFamily: FONT_DISPLAY }}>
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
// Pricing — números direto de lib/plans.ts (fonte real do checkout)
// ---------------------------------------------------------------------------

type BillingCycle = "monthly" | "annual";

/**
 * Destaques numéricos por plano (agentes de IA, funis, hierarquia) — não
 * exportados como campo próprio em `lib/plans.ts` (ficam embutidos no texto
 * corrido de `SALES_PLANS[].features`), então replicados aqui à mão.
 * Se os números de `SALES_PLANS` mudarem, atualizar isto também.
 */
const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  solo: ["Até 2 agentes de IA", "Até 5 funis de vendas", "Sem diretores/gerentes — só você"],
  equipa: ["Até 5 agentes de IA", "Até 12 funis de vendas", "Hierarquia: 1 diretor, 3 gerentes, 30 vendedores"],
  escala: ["Até 30 agentes de IA", "Até 25 funis de vendas", "Hierarquia: 5 diretores, 25 gerentes, 30 vendedores"],
};

const CHECKOUT_PLANS = SALES_PLANS.filter((p) => !p.contactOnly && p.priceMonthly !== null);
const ENTERPRISE_PLAN = SALES_PLANS.find((p) => p.contactOnly);

function PricingV2() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const reducedMotion = useReducedMotion();

  return (
    <section id="planos" className="mx-auto max-w-[1200px] scroll-mt-[88px] px-8 py-24">
      <div className="mx-auto mb-14 max-w-[640px] text-center">
        <p className="mb-3.5 text-[12.5px] font-bold uppercase tracking-[0.12em]" style={{ color: "#F24400" }}>
          Planos
        </p>
        <h2 className="mb-4 text-[36px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text sm:text-[40px]" style={{ fontFamily: FONT_DISPLAY }}>
          Escolha o plano ideal
        </h2>
        <p className="mb-8 text-[17px] leading-[1.6] text-mc-muted">
          Cobrança liberada na hora — 7 dias de garantia pra pedir reembolso se não for pra você.
        </p>

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
                  −{PLAN_ANNUAL_DISCOUNT_PERCENT}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {CHECKOUT_PLANS.map((plan, i) => {
          const price = Math.round(planEffectiveMonthlyBRL(plan.priceMonthly as number, cycle));
          const popular = plan.accent === "popular";
          return (
            <motion.div
              key={plan.slug}
              initial={reducedMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ delay: i * 0.08, duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
              whileHover={reducedMotion ? undefined : { y: -4 }}
              className="relative"
            >
              {popular && (
                <div
                  aria-hidden
                  className={cn("absolute -inset-[2px] -z-10 rounded-mc-base opacity-30", !reducedMotion && "animate-landing-rotate-border")}
                  style={{ background: "conic-gradient(from 0deg, #F24400, transparent 35%, transparent 65%, #F24400)" }}
                />
              )}
              <div
                className={cn(
                  "flex h-full flex-col rounded-mc-base border p-7 transition-colors",
                  popular ? "border-[#F24400] bg-mc-surface" : "border-mc-border bg-mc-surface hover:border-[rgba(242,68,0,0.35)]",
                )}
              >
                {popular && (
                  <div className="mb-4 inline-flex items-center self-start rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: "#F24400" }}>
                    {plan.badge}
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
                  {cycle === "annual" && <p className="mt-1 text-[12px] text-mc-muted">cobrado anualmente</p>}
                </div>

                <ul className="mb-8 flex-1 space-y-2.5">
                  <li className="flex items-start gap-2.5 text-[14px] text-mc-text">
                    <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" style={{ color: "#00A650" }} />
                    {plan.monthlyLeadsLabel}
                  </li>
                  <li className="flex items-start gap-2.5 text-[14px] text-mc-text">
                    <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" style={{ color: "#00A650" }} />
                    {plan.whatsappNumbers}
                  </li>
                  {(PLAN_HIGHLIGHTS[plan.slug] ?? []).map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[14px] text-mc-text">
                      <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" style={{ color: "#00A650" }} />
                      {f}
                    </li>
                  ))}
                  <li className="flex items-start gap-2.5 text-[14px] text-mc-text">
                    <Check size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" style={{ color: "#00A650" }} />
                    Leads no CRM Kanban ilimitados
                  </li>
                </ul>

                <Link
                  href={`/login?plan=${plan.slug}&ciclo=${cycle}`}
                  className={cn(
                    "block rounded-mc-base py-3.5 text-center text-[14.5px] font-bold transition active:scale-[0.98]",
                    popular ? "text-white" : "border border-mc-border bg-mc-surface-2 text-mc-text hover:bg-mc-border",
                  )}
                  style={popular ? { background: "#F24400" } : undefined}
                >
                  Começar com {plan.name}
                </Link>
              </div>
            </motion.div>
          );
        })}
      </div>

      {ENTERPRISE_PLAN && (
        <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-mc-base border border-mc-border bg-mc-surface p-6 sm:flex-row sm:items-center md:px-8">
          <div>
            <p className="text-[17px] font-bold text-mc-text">{ENTERPRISE_PLAN.name}</p>
            <p className="mt-0.5 text-[14px] text-mc-muted">{ENTERPRISE_PLAN.tagline}</p>
          </div>
          <a
            href="mailto:comercial@mychatcrm.com.br"
            data-lead-gate="contact"
            className="shrink-0 rounded-mc-base border border-mc-border bg-mc-surface-2 px-5 py-2.5 text-[14px] font-semibold text-mc-text hover:bg-mc-border transition active:scale-[0.98]"
          >
            Falar com comercial
          </a>
        </div>
      )}
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
  { q: "Como funciona a garantia de 7 dias?", a: "A cobrança acontece na ativação do plano. Se não gostar, você tem 7 dias pra pedir reembolso — sem burocracia." },
  { q: "O que acontece se eu passar do limite de leads?", a: "Você será notificado antes de atingir o limite. É possível fazer upgrade de plano ou adquirir pacotes adicionais." },
] as const;

function FAQV2() {
  const [open, setOpen] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();

  return (
    <section className="mx-auto max-w-[760px] px-8 py-24">
      <h2 className="mb-12 text-center text-[36px] font-extrabold leading-[1.1] tracking-[-0.03em] text-mc-text sm:text-[40px]" style={{ fontFamily: FONT_DISPLAY }}>
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
                  <p className="border-t border-mc-border px-6 pb-5 pt-4 text-[15px] leading-[1.65] text-mc-muted">{a}</p>
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
        <h2 className="mb-5 text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white sm:text-[42px]" style={{ fontFamily: FONT_DISPLAY }}>
          Comece hoje, veja o agente em ação
        </h2>
        <p className="mx-auto mb-8 max-w-[520px] text-[17px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          Configure seu primeiro agente, conecte o WhatsApp e deixe o MyChatCRM cuidar do resto.
        </p>
        <Link
          href="/login"
          className="landing-cta-shimmer inline-flex items-center gap-2 rounded-mc-base px-8 py-4 text-[16px] font-bold text-white active:scale-[0.98]"
          style={{ background: "#F24400" }}
        >
          Criar conta gratuita
        </Link>
        <p className="mt-5 text-[13px]" style={{ color: "#64748b" }}>
          Sem cartão de crédito pra começar · Garantia de 7 dias em qualquer plano pago · Cancele quando quiser
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
          <span className="text-[15px] font-bold tracking-tight text-mc-text" style={{ fontFamily: FONT_DISPLAY }}>
            MyChatCRM
          </span>
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
              data-lead-gate={s.platform === "whatsapp" ? "contact" : undefined}
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
    const id = requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "start" }));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="min-h-dvh bg-mc-bg">
      <NavV2 />
      <main>
        <HeroV2 />
        <CapabilityStripV2 />
        <HowAgentDecidesV2 />
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
