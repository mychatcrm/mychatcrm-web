"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Bell,
  BookOpen,
  Bot,
  Calendar,
  ChevronDown,
  HelpCircle,
  LayoutGrid,
  LifeBuoy,
  MessageCircle,
  Plug,
  Search,
  Send,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

const SUPPORT_WHATSAPP_HREF =
  "https://wa.me/5562999999999?text=" + encodeURIComponent("Olá, preciso de ajuda com o MyChatCRM.");

type MiniCourse = {
  id: string;
  title: string;
  blurb: string;
  icon: typeof BookOpen;
  minutes: string;
  steps: string[];
  links: { label: string; href: string }[];
};

const MINI_COURSES: MiniCourse[] = [
  {
    id: "inicio",
    title: "Primeiros passos no painel",
    blurb: "Onde clicar primeiro e como navegar sem se perder.",
    icon: Sparkles,
    minutes: "~4 min",
    steps: [
      "Use o menu à esquerda para mudar de área: relatório, CRM Kanban, agentes, agenda, etc.",
      "O canto inferior abre Configurações (conta, plano, notificações, segurança). O WhatsApp liga em Integrações.",
      "No CRM Kanban, clique num cartão para abrir a ficha do lead: histórico, tarefas e WhatsApp.",
    ],
    links: [
      { label: "Ir ao relatório", href: "/dashboard" },
      { label: "Abrir CRM Kanban", href: "/dashboard/crm" },
    ],
  },
  {
    id: "crm",
    title: "CRM Kanban e funil de vendas",
    blurb: "Leads, colunas e acompanhamento do negócio.",
    icon: LayoutGrid,
    minutes: "~6 min",
    steps: [
      "Cada coluna é uma etapa: arraste o cartão para mudar o estágio do lead.",
      "Use a busca e filtros para achar por nome, empresa ou tag.",
      "Na ficha do lead, registe notas e follow-up; o termómetro resume o engajamento.",
    ],
    links: [{ label: "Abrir CRM Kanban", href: "/dashboard/crm" }],
  },
  {
    id: "agentes",
    title: "Agentes de IA",
    blurb: "Como funcionam os bots e o treino básico.",
    icon: Bot,
    minutes: "~5 min",
    steps: [
      "Cada agente atende um contexto (comercial, suporte, etc.).",
      "Preencha objetivo e exemplos: quanto mais claro, melhor a resposta automática.",
      "Ligue o agente ao funil certo para novos leads caírem na coluna esperada.",
    ],
    links: [{ label: "Gerir agentes", href: "/dashboard/agentes" }],
  },
  {
    id: "disparos",
    title: "Disparos em massa (plano Master)",
    blurb: "Campanhas no WhatsApp com segmentação e rascunhos.",
    icon: Send,
    minutes: "~7 min",
    steps: [
      "Escolha a audiência: base completa, por tag ou por etapa do funil.",
      "Use variáveis como {{nome}} e {{empresa}} na mensagem; veja a pré-visualização ao lado.",
      "Guarde rascunhos e use modelos prontos para ganhar tempo.",
    ],
    links: [{ label: "Abrir disparos", href: "/dashboard/disparos" }],
  },
  {
    id: "agenda",
    title: "Agenda comercial",
    blurb: "Eventos, vistas e Google Agenda.",
    icon: Calendar,
    minutes: "~5 min",
    steps: [
      "Alterne entre dia, semana e mês para planear reuniões.",
      "Crie eventos com tipo e link de Meet; pode pedir lembrete por WhatsApp.",
      "Integrações > Google Agenda usa o mesmo estado da barra lateral da Agenda.",
    ],
    links: [{ label: "Abrir agenda", href: "/dashboard/agenda" }],
  },
  {
    id: "lembretes",
    title: "Central de lembretes (Master)",
    blurb: "Tudo num só lugar: CRM Kanban, agenda, disparos e alertas.",
    icon: Bell,
    minutes: "~4 min",
    steps: [
      "A lista junta próximas ações do CRM Kanban, tarefas com prazo, agenda e integrações.",
      "Use os filtros no topo para focar só num módulo.",
      "Clique em Abrir para ir direto à área certa.",
    ],
    links: [{ label: "Abrir lembretes", href: "/dashboard/lembretes" }],
  },
  {
    id: "integracoes",
    title: "Integrações",
    blurb: "Ligar ferramentas externas sem expor segredos no navegador.",
    icon: Plug,
    minutes: "~3 min",
    steps: [
      "Cada cartão mostra se a ligação está ativa; Configure abre um formulário simples.",
      "Google Agenda partilha o mesmo estado da página Agenda.",
      "Não guarde API keys completas no campo de nota — em produção isso fica no servidor.",
    ],
    links: [{ label: "Abrir integrações", href: "/dashboard/integracoes" }],
  },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Onde altero o plano ou vejo faturação?",
    a: "Em Configurações → Plano e Cobrança. Se o botão estiver indisponível, fale com o comercial pelo WhatsApp abaixo.",
  },
  {
    q: "Por que não vejo Disparos ou Lembretes?",
    a: "Esses módulos são do plano Master. No menu aparecem com selo Master até fazer upgrade.",
  },
  {
    q: "Os dados do CRM Kanban somem ao mudar de computador?",
    a: "Neste ambiente de demo, leads e integrações podem usar armazenamento local do navegador. Em produção com login na nuvem, tudo segue a tua conta.",
  },
];

export function SuporteHub({ supportTickets }: { supportTickets: string[] }) {
  const { isLight } = usePanelAppearance();
  const [query, setQuery] = useState("");
  const [openCourse, setOpenCourse] = useState<string | null>(MINI_COURSES[0]?.id ?? null);
  const [ticketTitle, setTicketTitle] = useState("");
  const [ticketCat, setTicketCat] = useState("tecnico");
  const [ticketPri, setTicketPri] = useState("media");
  const [ticketBody, setTicketBody] = useState("");
  const [ticketSent, setTicketSent] = useState(false);
  const [ticketErr, setTicketErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MINI_COURSES;
    return MINI_COURSES.filter((c) => {
      const blob = `${c.title} ${c.blurb} ${c.steps.join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [query]);

  const submitTicket = useCallback(() => {
    setTicketErr(null);
    const t = ticketTitle.trim();
    const b = ticketBody.trim();
    if (t.length < 4) {
      setTicketErr("Escreva um título um pouco mais descritivo (mínimo 4 caracteres).");
      return;
    }
    if (b.length < 12) {
      setTicketErr("Descreva o problema com pelo menos 12 caracteres para a equipa entender o contexto.");
      return;
    }
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setTicketSent(true);
      setTicketTitle("");
      setTicketBody("");
      setTicketCat("tecnico");
      setTicketPri("media");
    }, 650);
  }, [ticketBody, ticketTitle]);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm",
            isLight ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-900" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
          )}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium">Serviços online</span>
          <span className="text-current/80">API WhatsApp, IA, CRM Kanban, integrações e agenda estão a responder neste ambiente de demonstração.</span>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-content">
            <BookOpen className="size-4 text-primary" aria-hidden />
            Mini cursos rápidos
          </div>
          <p className="mb-4 text-sm text-content-secondary">
            Passos curtos para cada parte do sistema. Use a pesquisa para achar o tema.
          </p>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex.: CRM Kanban, agenda, disparos, lembretes…"
              className="rounded-xl pl-10"
              aria-label="Filtrar mini cursos"
            />
          </div>
          <div className="space-y-2">
            {filteredCourses.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface-card/40 px-4 py-6 text-center text-sm text-content-secondary">
                Nenhum curso corresponde à pesquisa. Limpe o campo ou tente outra palavra.
              </p>
            ) : (
              filteredCourses.map((course) => {
                const Icon = course.icon;
                const open = openCourse === course.id;
                return (
                  <div
                    key={course.id}
                    className={cn(
                      "overflow-hidden rounded-xl border transition-colors",
                      isLight ? "border-slate-200/90 bg-surface-deep" : "border-line bg-surface-card/40",
                      open && "ring-1 ring-primary/25",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenCourse((v) => (v === course.id ? null : course.id))}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-elevated/25"
                      aria-expanded={open}
                    >
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                        <Icon className="size-5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-content">{course.title}</p>
                        <p className="text-xs text-content-secondary">{course.blurb}</p>
                      </div>
                      <Badge className="shrink-0 text-[10px]">{course.minutes}</Badge>
                      <ChevronDown
                        className={cn("size-5 shrink-0 text-content-muted transition-transform", open && "rotate-180")}
                        aria-hidden
                      />
                    </button>
                    {open ? (
                      <div className="border-t border-line/70 px-4 pb-4 pt-2">
                        <ol className="list-decimal space-y-2 pl-5 text-sm text-content-secondary">
                          {course.steps.map((s, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {s}
                            </li>
                          ))}
                        </ol>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {course.links.map((l) => (
                            <Link
                              key={l.href}
                              href={l.href}
                              className="inline-flex items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
                            >
                              {l.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-content">
            <HelpCircle className="size-4 text-primary" aria-hidden />
            Perguntas frequentes
          </div>
          <ul className="space-y-3">
            {FAQ_ITEMS.map((item) => (
              <li
                key={item.q}
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  isLight ? "border-slate-200/90 bg-slate-50/80" : "border-line bg-surface-deep/35",
                )}
              >
                <p className="font-medium text-content">{item.q}</p>
                <p className="mt-2 leading-relaxed text-content-secondary">{item.a}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
        <div
          className={cn(
            "rounded-xl border p-5 sm:rounded-xl",
            isLight ? "border-slate-200/90 bg-surface-deep" : "border-line bg-surface-deep/40",
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <LifeBuoy className="size-5 text-primary" aria-hidden />
            <h3 className="text-base font-semibold text-content">Abrir ticket</h3>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-content-secondary">
            Em produção o pedido segue para a fila da equipa MyChatCRM. Aqui simulamos o envio com validação para evitar pedidos vazios.
          </p>
          {ticketSent ? (
            <div
              className={cn(
                "flex gap-3 rounded-xl border px-4 py-3 text-sm",
                isLight ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
              )}
              role="status"
            >
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Pedido registado (demonstração)</p>
                <p className="mt-1 text-xs opacity-90">Receberá um e-mail de confirmação quando o backend estiver ligado.</p>
                <Button type="button" variant="ghost" size="sm" className="mt-3 px-0" onClick={() => setTicketSent(false)}>
                  Abrir novo pedido
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {ticketErr ? (
                <p className={cn("rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs", isLight ? "text-rose-700" : "text-rose-200")} role="alert">
                  {ticketErr}
                </p>
              ) : null}
              <div>
                <label className="text-xs font-medium text-content-secondary" htmlFor="ticket-title">
                  Título
                </label>
                <Input
                  id="ticket-title"
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  placeholder="Resumo em uma linha"
                  className="mt-1"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-content-secondary" htmlFor="ticket-cat">
                    Área
                  </label>
                  <Select id="ticket-cat" className="mt-1" value={ticketCat} onChange={(e) => setTicketCat(e.target.value)}>
                    <option value="tecnico">Técnico</option>
                    <option value="financeiro">Financeiro</option>
                    <option value="comercial">Comercial</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-content-secondary" htmlFor="ticket-pri">
                    Prioridade
                  </label>
                  <Select id="ticket-pri" className="mt-1" value={ticketPri} onChange={(e) => setTicketPri(e.target.value)}>
                    <option value="baixa">Baixa</option>
                    <option value="media">Média</option>
                    <option value="alta">Alta</option>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary" htmlFor="ticket-body">
                  Descrição
                </label>
                <textarea
                  id="ticket-body"
                  value={ticketBody}
                  onChange={(e) => setTicketBody(e.target.value)}
                  placeholder="O que aconteceu, em que página, e o que já tentou?"
                  rows={5}
                  maxLength={4000}
                  className={cn(
                    "mt-1 w-full resize-y rounded-xl border px-4 py-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20",
                    isLight ? "border-slate-200 bg-surface-deep text-content" : "border-line bg-surface-card/50 text-content",
                  )}
                />
              </div>
              <Button type="button" variant="gradient" className="w-full" onClick={submitTicket} isLoading={sending}>
                Enviar pedido de suporte
              </Button>
            </div>
          )}
        </div>

        <div
          className={cn(
            "rounded-xl border p-5 sm:rounded-xl",
            isLight ? "border-slate-200/90 bg-surface-deep" : "border-line bg-surface-deep/40",
          )}
        >
          <h3 className="text-sm font-semibold text-content">Pedidos recentes (demo)</h3>
          <ul className="mt-3 space-y-2 text-sm text-content-secondary">
            {supportTickets.map((item) => (
              <li key={item} className="rounded-xl border border-line/60 bg-surface-card/30 px-3 py-2">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <a
          href={SUPPORT_WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition",
            isLight
              ? "border-emerald-300/80 bg-emerald-600 text-white hover:bg-emerald-700"
              : "border-emerald-500/40 bg-emerald-600/90 text-white hover:bg-emerald-600",
          )}
        >
          <MessageCircle className="size-5 shrink-0" aria-hidden />
          Falar com suporte no WhatsApp
        </a>
      </div>
    </div>
  );
}
