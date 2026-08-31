"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ChevronUp, MessageCircle, Zap, Users, BarChart2, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { planEffectiveMonthlyBRL } from "@/lib/plans";

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

function NavV2() {
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
          {["Recursos", "Como funciona", "Planos", "Blog"].map((l) => (
            <span key={l} className="cursor-pointer text-[14.5px] font-medium text-mc-text opacity-70 transition hover:opacity-100">
              {l}
            </span>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-[14.5px] font-semibold text-mc-text hover:opacity-70 transition">
            Entrar
          </Link>
          <Link
            href="/login"
            className="rounded-mc-base px-4 py-2.5 text-[14px] font-semibold text-white active:scale-[0.98] transition-opacity hover:opacity-90"
            style={{ background: "#F24400" }}
          >
            Começar grátis
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function HeroV2() {
  return (
    <section className="mx-auto grid max-w-[1200px] grid-cols-1 gap-14 px-8 py-20 md:grid-cols-2 md:items-center">
      {/* Left */}
      <div>
        {/* Badge */}
        <div className="mb-5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5" style={{ background: "#fff4ee", border: "1px solid #f7ddcf" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#F24400" }} />
          <span className="text-[12.5px] font-semibold" style={{ color: "#B22A00" }}>Líder em Inteligência Comercial</span>
        </div>

        <h1 className="mb-6 text-[52px] font-extrabold leading-[1.04] tracking-[-0.038em] text-mc-text">
          Atenda, venda e organize com{" "}
          <span style={{ color: "#F24400" }}>IA</span> no WhatsApp.
        </h1>

        <p className="mb-8 text-[18px] leading-[1.6] text-mc-muted">
          Automatize o atendimento, capture leads e feche mais negócios — tudo integrado ao CRM.
        </p>

        {/* CTAs */}
        <div className="mb-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-mc-base px-6 py-3.5 text-[15px] font-bold text-white active:scale-[0.98]"
            style={{ background: "#F24400" }}
          >
            Começar grátis
          </Link>
          <Link
            href="#como-funciona"
            className="inline-flex items-center gap-2 rounded-mc-base border border-mc-border bg-mc-surface px-6 py-3.5 text-[15px] font-bold text-mc-text transition hover:bg-mc-surface-2 active:scale-[0.98]"
          >
            Ver como funciona
          </Link>
        </div>

        {/* Bullet features */}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {["100% em nuvem", "ChatGPT no WhatsApp", "API Oficial (Meta)", "CRM Kanban + Agenda"].map((f) => (
            <span key={f} className="flex items-center gap-1.5 text-[13.5px] font-medium text-mc-muted">
              <Check size={14} strokeWidth={2} style={{ color: "#00A650" }} />
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Right — chat mockup */}
      <div className="relative">
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
        <div className="absolute -bottom-4 -left-4 flex items-center gap-2.5 rounded-[12px] bg-mc-surface px-3.5 py-2.5 shadow-none border border-mc-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "#ecfdf3" }}>
            <span style={{ color: "#067a3c", fontSize: "16px" }}>📈</span>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-mc-text">+42% conversão</p>
            <p className="text-[11px] text-mc-muted">média entre clientes</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trust bar
// ---------------------------------------------------------------------------

function TrustBarV2() {
  const stats = [
    { n: "+1.200", label: "clientes ativos" },
    { n: "98%", label: "satisfação" },
    { n: "24/7", label: "IA operando" },
    { n: "+3M", label: "mensagens/mês" },
  ];

  return (
    <div className="border-y border-mc-border bg-mc-surface">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 px-8 py-6 md:grid-cols-4">
        {stats.map((s, i) => (
          <div key={i} className={cn("flex flex-col items-center py-4 text-center", i < stats.length - 1 && "border-r border-mc-border")}>
            <p className="text-[26px] font-extrabold tracking-tight text-mc-text">{s.n}</p>
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
  return (
    <section className="mx-auto max-w-[1200px] px-8 py-24">
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
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-mc-base border border-mc-border bg-mc-surface p-7">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: "#fff4ee" }}>
              <Icon size={20} strokeWidth={1.9} style={{ color: "#F24400" }} />
            </div>
            <p className="mb-2 text-[17px] font-bold tracking-tight text-mc-text">{title}</p>
            <p className="text-[14px] leading-[1.55] text-mc-muted">{desc}</p>
          </div>
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
  return (
    <section id="como-funciona" style={{ background: "#0E1D29" }}>
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
          {STEPS.map(({ n, title, desc }) => (
            <div key={n} className="rounded-[16px] p-7" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
              <p className="mb-4 text-[13px] font-bold" style={{ color: "#F24400" }}>{n}</p>
              <p className="mb-2.5 text-[19px] font-bold leading-tight tracking-tight text-white">{title}</p>
              <p className="text-[14.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>{desc}</p>
            </div>
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

  return (
    <section id="planos" className="mx-auto max-w-[1200px] px-8 py-24">
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
        {PLANS.map((plan) => {
          const price = Math.round(planEffectiveMonthlyBRL(plan.priceMonthly, cycle));
          return (
            <div
              key={plan.slug}
              className={cn(
                "flex flex-col rounded-mc-base border p-7",
                plan.highlight
                  ? "border-[#F24400] bg-mc-surface"
                  : "border-mc-border bg-mc-surface",
              )}
            >
              {plan.highlight && (
                <div className="mb-4 inline-flex items-center self-start rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: "#F24400" }}>
                  Mais popular
                </div>
              )}
              <p className="mb-1 text-[20px] font-extrabold tracking-tight text-mc-text">{plan.name}</p>
              <p className="mb-5 text-[13.5px] text-mc-muted">{plan.tagline}</p>

              <div className="mb-6">
                <span className="text-[38px] font-extrabold leading-none tracking-tight text-mc-text">
                  R${price}
                </span>
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
            </div>
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
              className="flex w-full items-center justify-between px-6 py-4 text-left"
              onClick={() => setOpen(open === i ? null : i)}
            >
              <span className="pr-4 text-[16px] font-semibold text-mc-text">{q}</span>
              {open === i ? (
                <ChevronUp size={18} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
              ) : (
                <ChevronDown size={18} strokeWidth={1.9} className="shrink-0 text-mc-muted" />
              )}
            </button>
            {open === i && (
              <p className="border-t border-mc-border px-6 pb-5 pt-4 text-[15px] leading-[1.65] text-mc-muted">
                {a}
              </p>
            )}
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
  return (
    <section className="mx-auto max-w-[1200px] px-8 pb-24">
      <div className="overflow-hidden rounded-mc-base p-12 text-center" style={{ background: "#0E1D29" }}>
        <h2 className="mb-5 text-[42px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">
          Comece hoje, veja resultados em 7 dias
        </h2>
        <p className="mx-auto mb-8 max-w-[520px] text-[17px] leading-[1.6]" style={{ color: "#94a3b8" }}>
          Mais de 1.200 empresas já usam o MyChatCRM para fechar negócios no WhatsApp com IA.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-mc-base px-8 py-4 text-[16px] font-bold text-white active:scale-[0.98]"
          style={{ background: "#F24400" }}
        >
          Criar conta gratuita
        </Link>
        <p className="mt-5 text-[13px]" style={{ color: "#64748b" }}>
          7 dias grátis · Sem cartão de crédito · Cancele quando quiser
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

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
            <Link key={label} href={href} className="text-[13.5px] font-medium text-mc-muted transition hover:text-mc-text">
              {label}
            </Link>
          ))}
        </div>

        <p className="text-[13px] text-mc-muted">© 2025 MyChatCRM · Todos os direitos reservados</p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Composed Landing V2
// ---------------------------------------------------------------------------

export function LandingV2() {
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
