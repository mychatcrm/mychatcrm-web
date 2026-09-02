"use client";

/**
 * Landing pública (home) — reconstruída do zero em 01/09/2026.
 *
 * Direção: "sala de controle". O produto é um agente comercial autónomo que
 * roda 24/7; a página mostra a máquina a funcionar em vez de a descrever.
 * Fundo escuro instrumentado, laranja da marca (#F24400) como único acento
 * forte, verde só para estado "ao vivo".
 *
 * Por que CSS próprio em vez de Tailwind puro: `.brand-marketing` (globals.css)
 * força Inter, tamanhos de h1/h2/h3 e `box-shadow: none !important` em todas as
 * páginas públicas. Reescrever aquilo mexeria em /planos, /blog, /login e
 * /checkout. Aqui a folha é escopada em `.mcx` com especificidade de duas
 * classes, que ganha de `.brand-marketing main h1` sem tocar em nada global.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Columns3,
  Cpu,
  Fingerprint,
  Gauge,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Paperclip,
  Plug,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { SALES_PLANS, PLAN_ANNUAL_DISCOUNT_PERCENT, planEffectiveMonthlyBRL } from "@/lib/plans";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";
import {
  BRL,
  McxFooter,
  McxNav,
  McxPage,
  NUM,
  Reveal,
  SectionLabel,
  priceBRL,
  useHashNav,
} from "@/components/marketing/mcx";

// ---------------------------------------------------------------------------
// Folha de estilo escopada
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Dados de página
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Consola do hero — o agente a decidir, ao vivo
// ---------------------------------------------------------------------------

/**
 * Consola do hero — o agente a decidir, ao vivo.
 *
 * Os passos de cada cenário são os do motor real (`processAgentTurnV2` +
 * o contrato estruturado em `lib/ai/agent-turn-plan.ts`). O agente não só
 * agenda: ele agrupa rajadas, transcreve áudio, lê imagem, consulta a API do
 * próprio cliente, envia arquivos do catálogo autorizado, transfere para um
 * humano, encerra o lead com citação literal e volta sozinho no follow-up.
 * Cada cenário aqui é uma dessas decisões — nenhuma métrica é inventada.
 */

type ConsoleStep = { name: string; note: string };

type ConsoleInbound = { text: string; kind?: "text" | "audio" | "image" };

type ConsoleScenario = {
  id: string;
  /** Rótulo do separador — o visitante pode saltar para qualquer cenário. */
  label: string;
  /** O que este cenário prova, em texto de uma linha. */
  claim: string;
  /** Linha de sistema em vez de mensagem do cliente (usada no follow-up). */
  systemLine?: string;
  inbound: ConsoleInbound[];
  steps: ConsoleStep[];
  reply: string;
  replyKind?: "text" | "audio";
  attachment?: string;
  footer: string;
};

const SCENARIOS: ConsoleScenario[] = [
  {
    id: "agenda",
    label: "Agenda",
    claim: "Marca o compromisso sozinho",
    inbound: [{ text: "Oi! Vi o anúncio de vocês. Ainda dá pra marcar uma visita na terça?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Conhecimento", note: "3 trechos da base do agente" },
      { name: "Agenda", note: "terça, 14h — horário livre" },
      { name: "CRM", note: "lead movido para Em conversa" },
      { name: "Entrega", note: "resposta enviada no WhatsApp" },
    ],
    reply:
      "Dá sim, Marina! Terça às 14h está livre — reservo pra você? Já te mando o endereço e um lembrete 1h antes.",
    footer: "Compromisso criado · lembrete agendado",
  },
  {
    id: "audio",
    label: "Áudio",
    claim: "Ouve o áudio e responde em voz",
    inbound: [
      { text: "áudio de voz · 0:14", kind: "audio" },
      { text: "e se der já me manda o valor" },
      { text: "obrigado!" },
    ],
    steps: [
      { name: "Rajada", note: "3 mensagens agrupadas em um turno" },
      { name: "Áudio", note: "transcrito antes de decidir" },
      { name: "Conhecimento", note: "tabela de preços na base" },
      { name: "Voz", note: "resposta gerada em áudio" },
      { name: "Entrega", note: "áudio enviado no WhatsApp" },
    ],
    reply:
      "Ouvi seu áudio, Rafael! Consigo sim fazer nessa condição. O valor fica em R$ 2.400 à vista ou em 3x sem juros — qual prefere?",
    replyKind: "audio",
    footer: "3 mensagens do cliente, 1 resposta só",
  },
  {
    id: "sistema",
    label: "Seu sistema",
    claim: "Consulta o seu sistema em tempo real",
    inbound: [{ text: "Vocês ainda têm apartamento de 2 quartos no Setor Bueno?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Conector", note: "API do cliente, operação autorizada" },
      { name: "Consulta", note: "somente leitura, campos declarados" },
      { name: "Resultado", note: "3 unidades disponíveis" },
      { name: "Entrega", note: "resposta enviada no WhatsApp" },
    ],
    reply:
      "Temos sim! Achei 3 unidades de 2 quartos no Setor Bueno, a partir de R$ 320.000. Quer que eu mande a ficha de cada uma?",
    footer: "Consulta ao sistema do cliente · nunca escreve nada",
  },
  {
    id: "arquivo",
    label: "Arquivos",
    claim: "Envia o material certo, na hora certa",
    inbound: [{ text: "Consegue me mandar a tabela de preços?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Catálogo", note: "arquivo autorizado localizado" },
      { name: "Verificação", note: "só envia o que o dono liberou" },
      { name: "Entrega", note: "texto + arquivo no WhatsApp" },
    ],
    reply: "Claro! Segue a tabela atualizada. Qualquer dúvida sobre as condições, me chama por aqui.",
    attachment: "tabela-precos-2026.pdf",
    footer: "Arquivo do catálogo do agente",
  },
  {
    id: "imagem",
    label: "Imagem",
    claim: "Lê o que o cliente manda na foto",
    inbound: [
      { text: "comprovante.jpg", kind: "image" },
      { text: "consegue confirmar se está certo?" },
    ],
    steps: [
      { name: "Rajada", note: "2 mensagens agrupadas em um turno" },
      { name: "Imagem", note: "analisada antes de decidir" },
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Conhecimento", note: "regras de pagamento na base" },
      { name: "Entrega", note: "resposta enviada no WhatsApp" },
    ],
    reply:
      "Recebi, Camila! O comprovante está no valor e no nome corretos. Já registrei aqui e te aviso assim que a equipe confirmar.",
    footer: "Imagem lida pelo agente",
  },
  {
    id: "humano",
    label: "Humano",
    claim: "Chama a pessoa certa na hora certa",
    inbound: [{ text: "Isso está bem acima do meu orçamento. Dá pra falar com um gerente?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Gatilho", note: "palavra-chave configurada: gerente" },
      { name: "Transferência", note: "conversa entregue ao responsável" },
      { name: "Aviso", note: "vendedor notificado no WhatsApp" },
      { name: "Automação", note: "pausada — ninguém fala por cima" },
    ],
    reply:
      "Claro! Já chamei o gerente responsável — ele continua com você por aqui mesmo, em instantes.",
    footer: "Automação pausada · humano no controle",
  },
  {
    id: "descarte",
    label: "Descarte",
    claim: "Sabe a hora de parar",
    inbound: [{ text: "Obrigado, mas eu só estava pesquisando. Não tenho interesse agora." }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Critérios", note: "regras do negócio configuradas" },
      { name: "Desfecho", note: "sem interesse — com citação literal" },
      { name: "CRM", note: "card movido para Perdido" },
      { name: "Atendimento", note: "encerrado, sem follow-up" },
    ],
    reply: "Sem problema! Se mudar de ideia é só me chamar por aqui. Boa semana.",
    footer: "Único desfecho terminal — só com critérios definidos",
  },
  {
    id: "followup",
    label: "Follow-up",
    claim: "Volta sozinho quando o lead some",
    systemLine: "sem resposta do cliente desde ontem",
    inbound: [],
    steps: [
      { name: "Silêncio", note: "intervalo configurado no agente" },
      { name: "Memória", note: "retoma o assunto de onde parou" },
      { name: "Tentativa", note: "1 de 3 configuradas" },
      { name: "CRM", note: "card movido para Em follow-up" },
      { name: "Entrega", note: "mensagem enviada no WhatsApp" },
    ],
    reply:
      "Oi Marina! Passando só pra saber se a terça às 14h ainda funciona pra você. Se preferir outro dia, me diz que eu remarco.",
    footer: "Follow-up automático · sem ninguém apertar nada",
  },
];

/** Pausa entre o fim de uma demonstração e o início da próxima. */
const CONSOLE_HOLD_MS = 7_000;
const TYPE_MS = 22;
const STEP_MS = 320;

function InboundIcon({ kind }: { kind: ConsoleInbound["kind"] }) {
  if (kind === "audio") return <Mic size={13} style={{ color: "var(--live)" }} />;
  if (kind === "image") return <ImageIcon size={13} style={{ color: "var(--live)" }} />;
  return null;
}

/**
 * Corpo de um cenário.
 *
 * Todos os oito são renderizados sempre, empilhados na mesma célula de grelha:
 * só o ativo fica visível, mas os outros continuam a ocupar espaço. É isso que
 * mantém a consola exatamente com a mesma altura em qualquer cenário — sem
 * isto a caixa variava 190px e a página saltava a cada troca. Como bónus, a
 * altura também não muda enquanto as mensagens são escritas.
 */
function ScenarioBody({
  scenario,
  active,
  reduced,
  msgIndex,
  chars,
  steps,
  replyOut,
}: {
  scenario: ConsoleScenario;
  active: boolean;
  reduced: boolean;
  msgIndex: number;
  chars: number;
  steps: number;
  replyOut: boolean;
}) {
  const inboundDone = msgIndex >= scenario.inbound.length;

  return (
    <div className="mcx-stack-item" data-on={active ? "true" : "false"} aria-hidden={!active}>
      <div className="mcx-console-claim">
        <Sparkles size={12} style={{ color: "var(--brand-hi)", flexShrink: 0 }} />
        <span>{scenario.claim}</span>
      </div>

      <div className="mcx-console-thread">
        {scenario.systemLine ? (
          <div className="mcx-console-system">
            <i />
            <span>{scenario.systemLine}</span>
            <i />
          </div>
        ) : null}

        {scenario.inbound.map((message, i) => {
          if (i > msgIndex) return null;
          const typing = active && i === msgIndex && !inboundDone;
          const text = typing ? message.text.slice(0, chars) : message.text;
          const media = message.kind && message.kind !== "text";
          return (
            <div key={`${scenario.id}-${i}`} className="mcx-bubble mcx-bubble-in">
              {media ? (
                <span className="mcx-bubble-media">
                  <InboundIcon kind={message.kind} />
                  <span>{text}</span>
                </span>
              ) : (
                <span>{text}</span>
              )}
              {typing ? <i className="mcx-caret" /> : null}
            </div>
          );
        })}
      </div>

      <div className="mcx-console-trace">
        {scenario.steps.map((step, i) => {
          const on = i < steps;
          return (
            <div key={`${scenario.id}-${step.name}`} className={on ? "mcx-trace on" : "mcx-trace"}>
              <span className="mcx-trace-idx">{String(i + 1).padStart(2, "0")}</span>
              <span className="mcx-trace-body">
                <span className="mcx-trace-name">{step.name}</span>
                <span className="mcx-trace-note">{on ? step.note : "—"}</span>
              </span>
              <motion.span
                initial={false}
                animate={{ opacity: on ? 1 : 0.18, scale: on ? 1 : 0.8 }}
                transition={{ duration: 0.24 }}
                style={{ color: on ? "var(--live)" : "var(--faint)", display: "flex" }}
              >
                <Check size={13} strokeWidth={3} />
              </motion.span>
            </div>
          );
        })}
      </div>

      <div className="mcx-console-reply">
        {replyOut ? (
          <motion.div
            initial={active && !reduced ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div className="mcx-bubble mcx-bubble-out">
              {scenario.replyKind === "audio" ? (
                <span className="mcx-bubble-media" style={{ marginBottom: 6 }}>
                  <Mic size={13} />
                  <span>resposta em áudio</span>
                </span>
              ) : null}
              {scenario.reply}
            </div>
            {scenario.attachment ? (
              <div className="mcx-attach">
                <Paperclip size={13} />
                <span>{scenario.attachment}</span>
              </div>
            ) : null}
            <div className="mcx-console-footer mcx-mono">{scenario.footer}</div>
            {active && !reduced ? (
              <div className="mcx-hold" aria-hidden="true">
                <i key={scenario.id} style={{ animationDuration: `${CONSOLE_HOLD_MS}ms` }} />
              </div>
            ) : (
              <div className="mcx-hold" aria-hidden="true" />
            )}
          </motion.div>
        ) : (
          <div
            className="mcx-mono"
            style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 6 }}
          >
            <Cpu size={13} style={{ color: "var(--brand)" }} />
            a decidir o próximo passo…
          </div>
        )}
      </div>
    </div>
  );
}

function HeroConsole() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const [steps, setSteps] = useState(0);
  const [replyOut, setReplyOut] = useState(false);

  const scenario = SCENARIOS[index]!;
  const inboundDone = msgIndex >= scenario.inbound.length;

  const goTo = useCallback((next: number) => {
    setIndex(((next % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length);
    setMsgIndex(0);
    setChars(0);
    setSteps(0);
    setReplyOut(false);
  }, []);

  // Sem movimento: mostra o estado final do cenário e não avança sozinho.
  useEffect(() => {
    if (!reduced) return;
    setMsgIndex(scenario.inbound.length);
    setChars(scenario.inbound[scenario.inbound.length - 1]?.text.length ?? 0);
    setSteps(scenario.steps.length);
    setReplyOut(true);
  }, [reduced, scenario]);

  // 1. Escreve as mensagens do cliente, uma a uma.
  useEffect(() => {
    if (reduced || inboundDone) return;
    const full = scenario.inbound[msgIndex]!.text;
    if (chars >= full.length) {
      const t = setTimeout(() => {
        setMsgIndex((v) => v + 1);
        setChars(0);
      }, 320);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setChars((v) => v + 1), TYPE_MS);
    return () => clearTimeout(t);
  }, [reduced, inboundDone, scenario, msgIndex, chars]);

  // 2. Acende os passos do raciocínio.
  useEffect(() => {
    if (reduced || !inboundDone || steps >= scenario.steps.length) return;
    const t = setTimeout(() => setSteps((v) => v + 1), steps === 0 ? 420 : STEP_MS);
    return () => clearTimeout(t);
  }, [reduced, inboundDone, steps, scenario]);

  // 3. Mostra a resposta.
  useEffect(() => {
    if (reduced || replyOut || !inboundDone || steps < scenario.steps.length) return;
    const t = setTimeout(() => setReplyOut(true), 420);
    return () => clearTimeout(t);
  }, [reduced, replyOut, inboundDone, steps, scenario]);

  // 4. Segura a leitura antes de passar ao cenário seguinte.
  useEffect(() => {
    if (reduced || !replyOut) return;
    const t = setTimeout(() => goTo(index + 1), CONSOLE_HOLD_MS);
    return () => clearTimeout(t);
  }, [reduced, replyOut, index, goTo]);

  return (
    <div className="mcx-console">
      <div className="mcx-console-bar">
        <span className="mcx-dot" />
        <span className="mcx-mono" style={{ letterSpacing: ".16em" }}>
          Agente ao vivo
        </span>
        <span style={{ flex: 1 }} />
        <span className="mcx-mono mcx-console-provider" style={{ fontSize: 10 }}>
          WhatsApp · API Oficial
        </span>
      </div>

      <div className="mcx-console-tabs" role="tablist" aria-label="Demonstrações do agente">
        {SCENARIOS.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={i === index ? "mcx-tab on" : "mcx-tab"}
            onClick={() => goTo(i)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mcx-stack">
        {/*
          Camada-fantasma: os oito cenários no estado final, sempre invisíveis.
          É ela que fixa a altura da caixa. Sem isto, quando o cenário mais alto
          era o ativo ele encolhia enquanto escrevia e arrastava a consola com
          ele (medido: 539px → 485px a meio da demonstração do Áudio).
        */}
        {SCENARIOS.map((item) => (
          <ScenarioBody
            key={`molde-${item.id}`}
            scenario={item}
            active={false}
            reduced={reduced === true}
            msgIndex={item.inbound.length}
            chars={0}
            steps={item.steps.length}
            replyOut
          />
        ))}
        {/* Camada visível: só o cenário atual, animado por cima do molde. */}
        <ScenarioBody
          key={`vivo-${scenario.id}`}
          scenario={scenario}
          active
          reduced={reduced === true}
          msgIndex={msgIndex}
          chars={chars}
          steps={steps}
          replyOut={replyOut}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const TRUST = [
  "API Oficial da Meta",
  "Responde a áudio e imagem",
  "2 linhas WhatsApp por conta",
  "CRM, agenda e follow-up juntos",
] as const;

function Hero() {
  const onHash = useHashNav();
  const reduced = useReducedMotion();

  return (
    <header style={{ position: "relative", overflow: "hidden" }}>
      <div className="mcx-grid" />
      <div
        className="mcx-aurora"
        style={{
          width: 620,
          height: 620,
          top: -260,
          left: "-8%",
          background: "rgba(242,68,0,.22)",
          animation: reduced ? undefined : "mcx-float 22s ease-in-out infinite alternate",
        }}
      />
      <div
        className="mcx-aurora"
        style={{
          width: 560,
          height: 560,
          top: -180,
          right: "-10%",
          background: "rgba(30,74,110,.34)",
        }}
      />

      <div
        className="mcx-shell mcx-hero"
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gap: "clamp(38px,5vw,62px)",
          padding: "clamp(56px,8vw,104px) 24px clamp(48px,6vw,80px)",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 660 }}>
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="mcx-chip">
              <span className="mcx-dot" />
              O comercial que não dorme
            </span>
          </motion.div>

          <motion.h1
            className="mcx-h1"
            initial={reduced ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            Seu WhatsApp responde,
            <br />
            qualifica e agenda
            <br />
            <span className="mcx-accent">sozinho.</span>
          </motion.h1>

          <motion.p
            className="mcx-lead"
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            O MyChatCRM lê a conversa inteira, decide o que fazer a cada mensagem, marca o
            compromisso na agenda, move o lead no CRM Kanban e passa para um humano na hora certa —
            tudo pela API Oficial da Meta.
          </motion.p>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
          >
            <Link href="/planos" className="mcx-btn mcx-btn-primary mcx-btn-lg">
              Ativar meu agente
              <ArrowRight size={17} />
            </Link>
            <Link
              href="#motor"
              onClick={(e) => onHash(e, "#motor")}
              className="mcx-btn mcx-btn-ghost mcx-btn-lg"
            >
              Ver como ele decide
            </Link>
          </motion.div>

          <motion.ul
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
              gap: "9px 22px",
            }}
          >
            {TRUST.map((t) => (
              <li
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  fontSize: ".875rem",
                  color: "var(--muted)",
                }}
              >
                <Check size={14} strokeWidth={3} style={{ color: "var(--live)", flexShrink: 0 }} />
                {t}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 28, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <HeroConsole />
        </motion.div>
      </div>
    </header>
  );
}

const TICKER_ITEMS = [
  ["Agentes de IA", "conforme o plano"],
  ["CRM Kanban", "funis e etapas próprias"],
  ["Agenda Google", "sincronizada"],
  ["Follow-up", "automático e com memória"],
  ["Disparos em massa", "com janela de horário"],
  ["Transferência", "para humano na hora certa"],
  ["APIs externas", "REST/JSON com OAuth2"],
  ["Equipas", "diretor, gerente e vendedor"],
] as const;

function Ticker() {
  const row = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="mcx-ticker" aria-hidden="true">
      <div className="mcx-ticker-row">
        {row.map(([a, b], i) => (
          <span className="mcx-ticker-item" key={`${a}-${i}`}>
            <b>{a}</b>
            {b}
            <span style={{ color: "var(--line-strong)", marginLeft: 16 }}>/</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motor — como o agente decide
// ---------------------------------------------------------------------------

const ENGINE = [
  {
    icon: MessageSquare,
    title: "Junta a rajada",
    body: "O cliente manda cinco mensagens seguidas? O agente espera terminar e responde uma vez só, no contexto de todas — não cinco respostas soltas.",
  },
  {
    icon: Fingerprint,
    title: "Lê quem é o lead",
    body: "Histórico da conversa, memória do contacto, origem (anúncio, formulário Meta, contacto espontâneo) e a base de conhecimento daquele agente.",
  },
  {
    icon: Calendar,
    title: "Marca de verdade",
    body: "Confere o horário no fuso certo, valida a data proposta e cria o compromisso na agenda. Se o horário não existe, ele não inventa.",
  },
  {
    icon: Columns3,
    title: "Move o lead no CRM",
    body: "Quando o cliente responde, o cartão anda de coluna sozinho no funil que você configurou. Sem ninguém arrastar nada à mão.",
  },
  {
    icon: Users,
    title: "Chama o humano",
    body: "Pedido de desconto, reclamação, palavra-chave que você definiu — a conversa passa para a pessoa certa e a automação pausa.",
  },
  {
    icon: RefreshCw,
    title: "Não deixa esfriar",
    body: "Se o cliente some, o follow-up volta sozinho no intervalo que você escolheu, lembrando do que já tinha sido conversado.",
  },
] as const;

function Engine() {
  return (
    <section id="motor" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>O motor</SectionLabel>
          <h2 className="mcx-h2">
            Cada mensagem passa por um raciocínio.
            <br />
            <span style={{ color: "var(--muted)" }}>Não por um roteiro fixo.</span>
          </h2>
          <p className="mcx-lead" style={{ marginTop: 18 }}>
            A maioria dos chatbots segue uma árvore de botões. Aqui, o agente decide o que fazer a
            cada mensagem — e o que ele decidiu fica registado, passo a passo.
          </p>
        </Reveal>

        <div className="mcx-pipe" style={{ marginTop: 44 }}>
          {ENGINE.map((node, i) => {
            const Icon = node.icon;
            return (
              <Reveal key={node.title} delay={i * 0.06}>
                <article className="mcx-card mcx-node" style={{ height: "100%" }}>
                  <div className="mcx-node-top">
                    <span className="mcx-node-idx">{String(i + 1).padStart(2, "0")}</span>
                    <span className="mcx-node-ico">
                      <Icon size={16} />
                    </span>
                  </div>
                  <h3 className="mcx-h3">{node.title}</h3>
                  <p className="mcx-body">{node.body}</p>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recursos — bento
// ---------------------------------------------------------------------------

function KanbanMini() {
  return (
    <div className="mcx-kan">
      {[
        { h: "Novo", cards: [0, 0] },
        { h: "Em conversa", cards: [1, 0, 0] },
        { h: "Proposta", cards: [1] },
      ].map((col) => (
        <div className="mcx-kan-col" key={col.h}>
          <div className="mcx-kan-h">{col.h}</div>
          {col.cards.map((hot, i) => (
            <div key={i} className={hot ? "mcx-kan-card hot" : "mcx-kan-card"} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BarsMini() {
  const heights = [34, 52, 41, 68, 58, 82, 74];
  return (
    <div className="mcx-bars">
      {heights.map((h, i) => (
        <div
          key={i}
          className={i >= 4 ? "mcx-bar on" : "mcx-bar"}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function SlotsMini() {
  return (
    <div className="mcx-slots">
      {[
        ["Terça · 14:00", "reservado", true],
        ["Terça · 16:30", "livre", false],
        ["Quarta · 09:00", "livre", false],
      ].map(([when, state, taken]) => (
        <div key={String(when)} className={taken ? "mcx-slot taken" : "mcx-slot"}>
          <span>{when}</span>
          <span>{state}</span>
        </div>
      ))}
    </div>
  );
}

/** Formatos que o agente entende na entrada e o que devolve. */
function FormatChips() {
  return (
    <div className="mcx-chips">
      {["áudio → transcrito", "imagem → analisada", "resposta em voz"].map((label) => (
        <span key={label} className="mcx-chip-sm">
          {label}
        </span>
      ))}
    </div>
  );
}

/** Hierarquia comercial: cada nível vê exatamente o que pode ver. */
function HierarchyMini() {
  return (
    <div className="mcx-hier">
      {[
        { role: "Diretor", scope: "as equipas dele" },
        { role: "Gerente", scope: "a equipa dele" },
        { role: "Vendedor", scope: "só os leads dele" },
      ].map((level, i) => (
        <div className="mcx-hier-row" key={level.role} style={{ marginLeft: i * 14 }}>
          <span className="mcx-hier-role">{level.role}</span>
          <span className="mcx-hier-scope">{level.scope}</span>
        </div>
      ))}
    </div>
  );
}

/** Por onde o agente se liga ao resto da operação. */
function IntegrationChips() {
  return (
    <div className="mcx-chips">
      {[
        "Formulários do Meta",
        "WhatsApp API Oficial",
        "Google Agenda",
        "REST / JSON",
        "OAuth2",
        "Disparos em massa",
      ].map((label) => (
        <span key={label} className="mcx-chip-sm">
          {label}
        </span>
      ))}
    </div>
  );
}

const FEATURES = [
  {
    size: "lg" as const,
    icon: Columns3,
    title: "CRM Kanban que se move sozinho",
    body: "Funis e colunas do seu jeito. O agente move o cartão quando o lead responde, e o vendedor só vê os leads que são dele.",
    visual: <KanbanMini />,
  },
  {
    size: "md" as const,
    icon: Calendar,
    title: "Agenda com horário real",
    body: "Confere disponibilidade, cria o compromisso e manda o lembrete antes.",
    visual: <SlotsMini />,
  },
  {
    size: "md" as const,
    icon: Gauge,
    title: "Relatório do que importa",
    body: "Leads, conversas, tempo de primeira resposta e desempenho por vendedor.",
    visual: <BarsMini />,
  },
  {
    size: "md" as const,
    icon: Mic,
    title: "Áudio, imagem e documento",
    body: "O cliente manda áudio, o agente entende. E responde em voz, se você quiser.",
    visual: <FormatChips />,
  },
  {
    size: "md" as const,
    icon: Users,
    title: "Equipa com hierarquia",
    body: "Diretor, gerente e vendedor. Cada um vê exatamente o que pode ver — a barreira é aplicada no servidor, não no ecrã.",
    visual: <HierarchyMini />,
  },
  {
    size: "full" as const,
    icon: Plug,
    title: "Conecta ao resto do seu negócio",
    body: "Formulários do Meta, disparos em massa com janela de horário, Google Agenda e conectores REST/JSON com OAuth2 para consultar o seu próprio sistema.",
    visual: <IntegrationChips />,
  },
] as const;

function Features() {
  return (
    <section id="recursos" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>Dentro do produto</SectionLabel>
          <h2 className="mcx-h2">Um painel só, do primeiro “oi” ao fechamento.</h2>
        </Reveal>

        <div className="mcx-bento" style={{ marginTop: 40 }}>
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal
                key={f.title}
                delay={i * 0.05}
                className={`mcx-b-${f.size}`}
              >
                <article className="mcx-card mcx-tile" style={{ height: "100%" }}>
                  <span className="mcx-tile-ico">
                    <Icon size={17} />
                  </span>
                  <h3 className="mcx-h3">{f.title}</h3>
                  <p className="mcx-body">{f.body}</p>
                  {f.visual}
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calculadora — os números são do próprio visitante, não nossos
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const id = `mcx-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="mcx-field">
      <div className="mcx-field-top">
        <label className="mcx-field-lbl" htmlFor={id}>
          {label}
        </label>
        <span className="mcx-field-val">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Calculator() {
  const [leads, setLeads] = useState(600);
  const [ticket, setTicket] = useState(2500);
  const [close, setClose] = useState(12);
  const [missed, setMissed] = useState(40);

  const { lost, recovered, plan } = useMemo(() => {
    const semResposta = (leads * missed) / 100;
    const fechados = (semResposta * close) / 100;
    const lostValue = fechados * ticket;
    // Cenário conservador: metade do que hoje fica sem resposta rápida passa a ser atendido.
    return { lost: lostValue, recovered: lostValue * 0.5, plan: 997 };
  }, [leads, ticket, close, missed]);

  return (
    <section id="calculadora" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>A conta</SectionLabel>
          <h2 className="mcx-h2">Quanto vale o lead que ninguém respondeu?</h2>
          <p className="mcx-lead" style={{ marginTop: 18 }}>
            Mexa nos controlos com os números reais da sua operação. A estimativa é sua — usamos
            apenas o que você informar, sem promessa de resultado.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mcx-calc" style={{ marginTop: 40 }}>
            <div className="mcx-panel" style={{ padding: "10px 26px 20px" }}>
              <Field
                label="Leads que chegam por mês"
                value={leads}
                min={50}
                max={5000}
                step={50}
                onChange={setLeads}
                format={(v) => NUM.format(v)}
              />
              <Field
                label="Ticket médio de uma venda"
                value={ticket}
                min={200}
                max={30000}
                step={100}
                onChange={setTicket}
                format={(v) => BRL.format(v)}
              />
              <Field
                label="Taxa de fechamento da equipa"
                value={close}
                min={1}
                max={40}
                step={1}
                onChange={setClose}
                format={(v) => `${v}%`}
              />
              <Field
                label="Leads sem resposta rápida hoje"
                value={missed}
                min={5}
                max={90}
                step={5}
                onChange={setMissed}
                format={(v) => `${v}%`}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="mcx-card mcx-readout">
                <span className="mcx-mono">Parado todo mês</span>
                <span className="mcx-readout-big">{BRL.format(lost)}</span>
                <p className="mcx-body" style={{ color: "var(--muted)" }}>
                  É o valor dos negócios que hoje entram e ficam sem resposta rápida —{" "}
                  {NUM.format(Math.round((leads * missed) / 100))} leads por mês.
                </p>
              </div>

              <div className="mcx-readout-split">
                <div className="mcx-readout-cell">
                  <span className="mcx-mono">Recuperando metade</span>
                  <span
                    className="mcx-num"
                    style={{
                      fontFamily: "var(--f-display)",
                      fontWeight: 700,
                      fontSize: "1.5rem",
                      letterSpacing: "-.03em",
                      color: "var(--live)",
                    }}
                  >
                    {BRL.format(recovered)}
                  </span>
                </div>
                <div className="mcx-readout-cell">
                  <span className="mcx-mono">Plano Escala</span>
                  <span
                    className="mcx-num"
                    style={{
                      fontFamily: "var(--f-display)",
                      fontWeight: 700,
                      fontSize: "1.5rem",
                      letterSpacing: "-.03em",
                    }}
                  >
                    {priceBRL(plan)}/mês
                  </span>
                </div>
              </div>

              <Link
                href="/planos"
                className="mcx-btn mcx-btn-primary mcx-btn-lg"
                style={{ width: "100%" }}
              >
                Quero parar de perder esses leads
                <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

type Cycle = "monthly" | "annual";

const CHECKOUT_PLANS = SALES_PLANS.filter((p) => !p.contactOnly && p.priceMonthly !== null);
const ENTERPRISE = SALES_PLANS.find((p) => p.contactOnly);

function Pricing() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const whatsapp = whatsappHandoffHref();

  return (
    <section id="planos" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>Planos</SectionLabel>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 22,
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2 className="mcx-h2">Preço em reais, sem letra miúda.</h2>
              <p className="mcx-lead" style={{ marginTop: 16 }}>
                Todos os planos trazem o produto inteiro — o que muda são os limites. Duas linhas de
                WhatsApp incluídas em qualquer um.
              </p>
            </div>
            <div className="mcx-toggle" role="group" aria-label="Ciclo de cobrança">
              <button
                type="button"
                className={cycle === "monthly" ? "on" : ""}
                onClick={() => setCycle("monthly")}
                aria-pressed={cycle === "monthly"}
              >
                Mensal
              </button>
              <button
                type="button"
                className={cycle === "annual" ? "on" : ""}
                onClick={() => setCycle("annual")}
                aria-pressed={cycle === "annual"}
              >
                Anual −{PLAN_ANNUAL_DISCOUNT_PERCENT}%
              </button>
            </div>
          </div>
        </Reveal>

        <div className="mcx-plans" style={{ marginTop: 40 }}>
          {CHECKOUT_PLANS.map((plan, i) => {
            const popular = plan.accent === "popular";
            const monthly = planEffectiveMonthlyBRL(plan.priceMonthly as number, cycle);
            const href = `/checkout/${plan.slug}${cycle === "annual" ? "?ciclo=anual" : ""}`;
            const bullets = plan.features.slice(1, 5);

            return (
              <Reveal key={plan.slug} delay={i * 0.06}>
                <article
                  className={popular ? "mcx-card mcx-plan mcx-plan-pop" : "mcx-card mcx-plan"}
                  style={{ height: "100%" }}
                >
                  {popular ? <span className="mcx-plan-badge">{plan.badge}</span> : null}
                  <div>
                    <h3
                      className="mcx-h3"
                      style={{ fontSize: "1.22rem", marginBottom: 6 }}
                    >
                      {plan.name}
                    </h3>
                    <p className="mcx-body" style={{ fontSize: ".85rem", minHeight: 42 }}>
                      {plan.tagline}
                    </p>
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                      <span className="mcx-price">{priceBRL(monthly)}</span>
                      <span className="mcx-mono" style={{ letterSpacing: ".1em" }}>
                        /mês
                      </span>
                    </div>
                    <p className="mcx-mono" style={{ marginTop: 7, textTransform: "none", letterSpacing: ".04em" }}>
                      {cycle === "annual"
                        ? `Cobrado anualmente · ${priceBRL(monthly * 12)}/ano`
                        : "Cobrado mensalmente"}
                    </p>
                  </div>

                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 11,
                      border: "1px solid var(--line)",
                      background: "rgba(255,255,255,.025)",
                    }}
                  >
                    <div className="mcx-mono" style={{ marginBottom: 5 }}>
                      Incluído
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text)" }}>
                      {plan.monthlyLeadsLabel}
                    </div>
                    <div style={{ fontSize: ".78rem", color: "var(--faint)", marginTop: 3 }}>
                      2 números WhatsApp (API oficial)
                    </div>
                  </div>

                  <ul className="mcx-plan-list">
                    {bullets.map((b) => (
                      <li key={b}>
                        <Check size={13} strokeWidth={3} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mcx-plan-foot">
                    <Link
                      href={href}
                      className={`mcx-btn ${popular ? "mcx-btn-primary" : "mcx-btn-ghost"}`}
                      style={{ width: "100%" }}
                    >
                      Assinar {plan.name}
                    </Link>
                  </div>
                </article>
              </Reveal>
            );
          })}

          {ENTERPRISE ? (
            <Reveal delay={0.24}>
              <article
                className="mcx-card mcx-plan"
                style={{
                  height: "100%",
                  background: "linear-gradient(180deg,rgba(14,29,41,.85),rgba(255,255,255,.012))",
                }}
              >
                <div>
                  <h3 className="mcx-h3" style={{ fontSize: "1.22rem", marginBottom: 6 }}>
                    {ENTERPRISE.name}
                  </h3>
                  <p className="mcx-body" style={{ fontSize: ".85rem", minHeight: 42 }}>
                    {ENTERPRISE.tagline}
                  </p>
                </div>
                <div>
                  <span className="mcx-price" style={{ fontSize: "1.9rem" }}>
                    Sob consulta
                  </span>
                  <p className="mcx-mono" style={{ marginTop: 7, textTransform: "none", letterSpacing: ".04em" }}>
                    Pacote e limites definidos com o comercial
                  </p>
                </div>
                <ul className="mcx-plan-list">
                  <li>
                    <Check size={13} strokeWidth={3} />
                    <span>Volume de leads e agentes à medida</span>
                  </li>
                  <li>
                    <Check size={13} strokeWidth={3} />
                    <span>Onboarding e acompanhamento dedicados</span>
                  </li>
                  <li>
                    <Check size={13} strokeWidth={3} />
                    <span>Contrato e faturação sob medida</span>
                  </li>
                </ul>
                <div className="mcx-plan-foot">
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mcx-btn mcx-btn-ghost"
                    style={{ width: "100%" }}
                  >
                    Falar com o comercial
                  </a>
                </div>
              </article>
            </Reveal>
          ) : null}
        </div>

        <Reveal delay={0.3}>
          <p
            className="mcx-mono"
            style={{ marginTop: 26, textTransform: "none", letterSpacing: ".03em", lineHeight: 1.7 }}
          >
            7 dias para pedir reembolso nos planos com checkout online · Número extra de WhatsApp:
            R$ 75/mês · Conector de API adicional: R$ 49,90/mês ·{" "}
            <Link href="/planos" style={{ color: "var(--brand-hi)" }}>
              ver comparativo completo
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQ = [
  {
    q: "Isto usa a API oficial do WhatsApp?",
    a: "Sim. Trabalhamos com a API Oficial da Meta (WhatsApp Business) — entregabilidade, segurança e conformidade com as regras da plataforma. Também há a opção de ligar por QR code quando faz sentido para o seu caso.",
  },
  {
    q: "Quantos números de WhatsApp posso ligar?",
    a: "Todos os planos incluem duas linhas: uma para os leads que vêm de formulários do Meta e outra para o WhatsApp direto. Cada número adicional custa R$ 75/mês.",
  },
  {
    q: "O agente responde a áudio?",
    a: "Responde. Ele transcreve o áudio do cliente, entende o pedido e pode responder por texto ou por voz, com a voz que você escolher para aquele agente.",
  },
  {
    q: "E quando a conversa precisa de uma pessoa?",
    a: "Você define os gatilhos — pedido de desconto, reclamação, palavras específicas. Nesse momento a automação pausa, a conversa vai para o responsável certo e ninguém fica a falar por cima do agente.",
  },
  {
    q: "Preciso de alguém técnico para configurar?",
    a: "Não. Os agentes são criados por um assistente passo a passo no painel, e o CRM, a agenda e os funis já vêm prontos para usar. Integrações mais avançadas ficam disponíveis quando você precisar.",
  },
  {
    q: "O vendedor consegue ver os leads dos colegas?",
    a: "Não. O recorte por equipa é aplicado no servidor, na própria consulta: o vendedor só recebe os leads atribuídos a ele, o gerente vê a equipa dele e o diretor vê as equipas em que está.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Pode. Os planos são mensais (ou anuais, com desconto) e o cancelamento é feito conforme os termos, sem multa escondida. Nos planos com checkout online (Solo, Equipa e Escala) ainda tem 7 dias para pedir reembolso se não ficar satisfeito.",
  },
] as const;

function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell" style={{ maxWidth: 900 }}>
        <Reveal>
          <SectionLabel>Dúvidas</SectionLabel>
          <h2 className="mcx-h2">O que costumam perguntar antes de assinar.</h2>
        </Reveal>

        <div style={{ marginTop: 34 }}>
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={i * 0.04}>
                <div className="mcx-faq-item">
                  <button
                    type="button"
                    className="mcx-faq-q"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    {item.q}
                    <ChevronDown size={18} className="mcx-faq-ico" />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        className="mcx-faq-a"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <p className="mcx-body">{item.a}</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA final
// ---------------------------------------------------------------------------

function FinalCta() {
  const whatsapp = whatsappHandoffHref();
  return (
    <section style={{ padding: "clamp(30px,5vw,60px) 0 clamp(70px,8vw,110px)" }}>
      <div className="mcx-shell">
        <Reveal>
          <div className="mcx-final">
            <div
              className="mcx-aurora"
              style={{
                width: 480,
                height: 480,
                bottom: -300,
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(242,68,0,.3)",
              }}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <span className="mcx-chip" style={{ marginBottom: 22 }}>
                <Sparkles size={12} style={{ color: "var(--brand-hi)" }} />
                Ative hoje
              </span>
              <h2 className="mcx-h2" style={{ maxWidth: 720, margin: "0 auto" }}>
                Enquanto você lê isto, alguém está a mandar mensagem para a sua empresa.
              </h2>
              <p className="mcx-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                Ligue o WhatsApp, crie o seu agente e deixe o comercial a trabalhar — inclusive às
                três da manhã.
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "center",
                  marginTop: 30,
                }}
              >
                <Link href="/planos" className="mcx-btn mcx-btn-primary mcx-btn-lg">
                  Escolher o meu plano
                  <ArrowRight size={17} />
                </Link>
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mcx-btn mcx-btn-ghost mcx-btn-lg"
                >
                  Falar no WhatsApp
                </a>
              </div>
              <p className="mcx-mono" style={{ marginTop: 20, textTransform: "none", letterSpacing: ".04em" }}>
                Sem instalação. 7 dias para pedir reembolso nos planos com checkout online.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rodapé
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Barra fixa (mobile) — só aparece depois do hero
// ---------------------------------------------------------------------------

function StickyBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 620);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="mcx-sticky"
          initial={{ y: 90 }}
          animate={{ y: 0 }}
          exit={{ y: 90 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <a
            href={whatsappHandoffHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="mcx-btn mcx-btn-ghost"
          >
            WhatsApp
          </a>
          <Link href="/planos" className="mcx-btn mcx-btn-primary">
            Ativar meu agente
          </Link>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function LandingV2() {
  // Chegar na home já com âncora na URL (ex.: "/#recursos" vindo do /blog):
  // não há clique para interceptar, só o carregamento.
  useEffect(() => {
    if (!window.location.hash) return;
    const el = document.querySelector(window.location.hash);
    if (!el) return;
    const id = requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "start" }));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <McxPage>
      <McxNav />
      <main>
        <Hero />
        <Ticker />
        <Engine />
        <Features />
        <Calculator />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <McxFooter />
      <StickyBar />
    </McxPage>
  );
}
