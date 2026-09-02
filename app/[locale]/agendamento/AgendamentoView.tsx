"use client";

/**
 * Página do agendamento automático.
 *
 * Mesma cena de sempre — coluna de texto à esquerda, palco à direita — mas o
 * movimento é automático: a coluna desliza sozinha para o ato seguinte e o
 * palco acompanha. Quem vende automação não devia pedir trabalho manual para
 * ver a demonstração.
 *
 * A coluna tem scroll PRÓPRIO. Automatizar o scroll da janela seria hostil —
 * briga com a roda do rato e dá enjoo a quem é sensível a movimento; aqui a
 * página fica quieta e só a coluna anda.
 *
 * Controlo de quem vê: botão de pausa, e mexer com a roda dentro da coluna
 * pausa na hora e devolve o comando. Enquanto está pausado, a posição da
 * coluna é que manda no ato — exatamente como era antes.
 *
 * Cada ato continua a ser texto real no HTML, indexável e legível por
 * rastreadores que não executam JS.
 */

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  MessageSquare,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { McxFooter, McxNav, McxPage, Reveal, SectionLabel } from "@/components/marketing/mcx";
import {
  ACTS,
  AGENDA_DAYS,
  AGENDA_HOURS,
  CRM_COLUMNS,
  ESTADO_INICIAL,
  type Act,
  type AgendaSlotState,
} from "./acts";

/** Tempo em cada ato. Dá para ler título, explicação e conversa sem correr. */
const ACT_MS = 10_000;
const TICK_MS = 250;

/* ------------------------------------------------------------------ palco */

/**
 * Cronograma de um ato, em milissegundos a contar do início dele.
 *
 * A cena tem de se ler como causa e efeito, não como um slide que troca: o lead
 * fala, o agente pensa, escreve, e SÓ DEPOIS a agenda muda e o card anda. Se
 * tudo aparecesse ao mesmo tempo, ninguém percebia quem fez o quê.
 */
const T_ENTRA = 320; // a mensagem do lead cai no ecrã
const T_PENSA = 1180; // o agente aparece a escrever
const T_ESCREVE = 2180; // a resposta começa a sair, letra a letra
const CHAR_MS = 16; // velocidade da escrita
const T_RESPIRO = 420; // pausa entre a resposta acabar e os efeitos
const FINE_MS = 60; // relógio da cena (só corre enquanto ela executa)

type Fase = 0 | 1 | 2 | 3 | 4 | 5;

const ROTULO_FASE: Record<Fase, string> = {
  0: "a receber",
  1: "a receber",
  2: "a decidir",
  3: "a responder",
  4: "a responder",
  5: "concluído",
};

/** Quanto tempo dura a parte animada deste ato. */
function duracaoCena(reply: string) {
  return T_ESCREVE + reply.length * CHAR_MS + T_RESPIRO + 600;
}

function faseEm(t: number, reply: string): Fase {
  const fimEscrita = T_ESCREVE + reply.length * CHAR_MS;
  if (t < T_ENTRA) return 0;
  if (t < T_PENSA) return 1;
  if (t < T_ESCREVE) return 2;
  if (t < fimEscrita) return 3;
  if (t < fimEscrita + T_RESPIRO) return 4;
  return 5;
}

/**
 * Camadas-fantasma: a altura do palco não pode mudar de ato para ato.
 *
 * Medido antes disto: o palco variava 72px entre atos e a barra de controlos
 * por baixo dele subia e descia a cada 10 segundos. Num bloco que se quer ver
 * como um vídeo, isso lê-se como defeito.
 *
 * Cada fantasma empilha TODOS os atos na mesma célula de grelha, invisível: o
 * mais alto fixa a altura e a camada real fica por cima. Como sai dos mesmos
 * dados, continua certo se amanhã um texto crescer — ao contrário de um número
 * de pixels escrito à mão. É a mesma técnica da consola da página inicial.
 */
const FantasmaConversa = memo(function FantasmaConversa() {
  return (
    <div className="mcx-h-ghost" aria-hidden="true">
      {ACTS.map((a) => (
        <div key={a.id} className="mcx-h-ghost-item">
          {a.systemLine ? (
            <div className="mcx-console-system">
              <i />
              <span>{a.systemLine}</span>
              <i />
            </div>
          ) : null}
          {a.inbound ? <div className="mcx-bubble mcx-bubble-in">{a.inbound}</div> : null}
          <div className="mcx-bubble mcx-bubble-out">{a.reply}</div>
        </div>
      ))}
    </div>
  );
});

const FantasmaEfeitos = memo(function FantasmaEfeitos() {
  return (
    <div className="mcx-h-ghost" aria-hidden="true">
      {ACTS.map((a) => (
        <ul key={a.id} className="mcx-effects mcx-h-ghost-item" data-on="true">
          {(a.effects ?? []).map((e) => (
            <li key={e} style={{ ["--i" as string]: 0 }}>
              <Check size={12} strokeWidth={3} />
              {e}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
});

const FantasmaTrace = memo(function FantasmaTrace() {
  return (
    <div className="mcx-h-ghost" aria-hidden="true">
      {ACTS.map((a) => (
        <div key={a.id} className="mcx-h-ghost-item mcx-h-ghost-row">
          {a.trace.map((step, i) => (
            <span key={step} className="mcx-stage-step">
              <span className="mcx-trace-idx">{String(i + 1).padStart(2, "0")}</span>
              {step}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
});

function ConversaPanel({ act, fase, escrito }: { act: Act; fase: Fase; escrito: string }) {
  return (
    <div className="mcx-stage-panel">
      <div className="mcx-stage-head">
        <MessageSquare size={13} />
        <span>Conversa no WhatsApp</span>
      </div>
      {/*
        As bolhas estão SEMPRE montadas e só ficam invisíveis até à sua vez. Se
        entrassem e saíssem do DOM, a caixa crescia a meio da cena e empurrava a
        agenda e o CRM para baixo — num palco preso no topo isso lê-se como
        defeito. Assim a altura é a mesma do primeiro ao último frame.
      */}
      <div className="mcx-stage-body mcx-stage-thread">
        {/*
          A altura do painel é fixada pelo FantasmaConversa, que empilha todos os
          atos invisíveis por baixo. Por isso a camada de cima pode entrar e sair
          à vontade: as bolhas caem no ecrã uma a uma e a bolha de "a escrever"
          fica pequena, como no WhatsApp, sem nada saltar por baixo.
        */}
        <FantasmaConversa />
        <div className="mcx-h-live">
          {act.systemLine && fase >= 1 ? (
            <div className="mcx-console-system mcx-drop">
              <i />
              <span>{act.systemLine}</span>
              <i />
            </div>
          ) : null}

          {act.inbound && fase >= 1 ? (
            <div className="mcx-bubble mcx-bubble-in mcx-drop">{act.inbound}</div>
          ) : null}

          {fase === 2 ? (
            <div className="mcx-bubble mcx-bubble-out mcx-drop" aria-label="O agente está a escrever">
              <span className="mcx-typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : null}

          {fase >= 3 ? (
            /* O texto completo, invisível, segura a largura e a altura da bolha:
               sem ele a caixa crescia a cada letra e tremia enquanto escrevia. */
            <div className="mcx-bubble mcx-bubble-out mcx-bubble-type">
              <span className="mcx-type-ghost" aria-hidden="true">
                {act.reply}
              </span>
              <span className="mcx-type-live">
                {escrito}
                {fase === 3 ? <i className="mcx-caret" /> : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Uma linha da grelha (hora + os quatro dias). */
function LinhaAgenda({
  hour,
  slots,
  mudou,
  aplicado,
}: {
  hour: string;
  slots: Record<string, AgendaSlotState>;
  mudou: Set<string>;
  aplicado: boolean;
}) {
  return (
    <>
      <span className="mcx-agenda-hour">{hour}</span>
      {AGENDA_DAYS.map((day) => {
        const key = `${day}-${hour}`;
        const state = slots[key] ?? "livre";
        return (
          <span
            key={day}
            className="mcx-agenda-slot"
            data-s={state}
            data-flash={aplicado && mudou.has(key) ? "true" : undefined}
            aria-label={`${day} ${hour}: ${state}`}
          />
        );
      })}
    </>
  );
}

const AgendaPanel = memo(function AgendaPanel({
  slots,
  mudou,
  aplicado,
}: {
  slots: Record<string, AgendaSlotState>;
  mudou: Set<string>;
  aplicado: boolean;
}) {
  return (
    <div className="mcx-stage-panel">
      <div className="mcx-stage-head">
        <Calendar size={13} />
        <span>Sua agenda</span>
      </div>
      <div className="mcx-stage-body">
        <div className="mcx-agenda-grid">
          <span />
          {AGENDA_DAYS.map((d) => (
            <span key={d} className="mcx-agenda-day">
              {d}
            </span>
          ))}
          {AGENDA_HOURS.map((h) => (
            <LinhaAgenda key={h} hour={h} slots={slots} mudou={mudou} aplicado={aplicado} />
          ))}
        </div>
        <div className="mcx-agenda-legend">
          <span>
            <i data-s="livre" /> livre
          </span>
          <span>
            <i data-s="ocupado" /> ocupado
          </span>
          <span>
            <i data-s="marcado" /> deste lead
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * O card no CRM.
 *
 * O card é UM só elemento com layoutId: quando muda de coluna, o Framer mede
 * onde ele estava e onde vai ficar e faz a viagem. É a peça que o Renato pediu
 * — o card a ser movido à frente de quem vê, não a reaparecer do outro lado.
 */
const CrmPanel = memo(function CrmPanel({
  coluna,
  viajando,
  efeitos,
  aplicado,
}: {
  coluna: number;
  viajando: boolean;
  efeitos: string[];
  aplicado: boolean;
}) {
  return (
    <div className="mcx-stage-panel">
      <div className="mcx-stage-head">
        <Cpu size={13} />
        <span>Card no CRM</span>
      </div>
      <div className="mcx-stage-body">
        <div className="mcx-crm-board">
          {CRM_COLUMNS.map((col, i) => (
            <div key={col} className="mcx-crm-col" data-on={i === coluna ? "true" : "false"}>
              <span className="mcx-crm-colname">{col}</span>
              {i === coluna ? (
                <motion.div
                  layoutId="mcx-lead-card"
                  className="mcx-crm-card"
                  data-travel={viajando ? "true" : undefined}
                  transition={{ type: "spring", stiffness: 210, damping: 26, mass: 0.9 }}
                >
                  <span className="mcx-crm-name">Marina</span>
                  <span className="mcx-crm-meta">atendimento</span>
                </motion.div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mcx-stage-thread mcx-efeitos-wrap">
          <FantasmaEfeitos />
          <ul className="mcx-effects mcx-h-live" data-on={aplicado ? "true" : "false"}>
            {efeitos.map((e, i) => (
              <li key={e} style={{ ["--i" as string]: i }}>
                <Check size={12} strokeWidth={3} />
                {e}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
});

/**
 * O palco.
 *
 * Tem relógio próprio, mais fino que o da página, e só corre enquanto a cena
 * executa — depois para sozinho e fica quieto até ao ato seguinte. Assim a
 * escrita letra a letra é suave sem re-renderizar a página inteira 160 vezes.
 */
function Stage({
  act,
  antes,
  correndo,
  reduced,
}: {
  act: Act;
  antes: { slots: Record<string, AgendaSlotState>; crmColumn: number };
  correndo: boolean;
  reduced: boolean;
}) {
  const [t, setT] = useState(0);
  const fim = duracaoCena(act.reply);

  // Refs para o reset não voltar a correr sempre que a pessoa pausa.
  const fimRef = useRef(fim);
  fimRef.current = fim;
  const correndoRef = useRef(correndo);
  correndoRef.current = correndo;

  // Ato novo: recomeça a cena. Se estiver pausada (a pessoa saltou de ato à
  // mão), mostra o resultado final — ninguém quer clicar e ver um palco parado.
  useEffect(() => {
    setT(correndoRef.current && !reduced ? 0 : fimRef.current);
  }, [act.id, reduced]);

  useEffect(() => {
    if (reduced || !correndo) return;
    const id = setInterval(() => {
      setT((v) => (v >= fimRef.current ? v : Math.min(fimRef.current, v + FINE_MS)));
    }, FINE_MS);
    return () => clearInterval(id);
  }, [correndo, reduced, act.id]);

  const fase = reduced ? 5 : faseEm(t, act.reply);
  const escritos = t <= T_ESCREVE ? 0 : Math.floor((t - T_ESCREVE) / CHAR_MS);
  const escrito = fase >= 4 ? act.reply : act.reply.slice(0, escritos);
  const aplicado = fase >= 5;

  const slots = aplicado ? act.slots : antes.slots;
  const coluna = aplicado ? act.crmColumn : antes.crmColumn;
  const mudou = useMemo(
    () => new Set(Object.keys(act.slots).filter((k) => act.slots[k] !== antes.slots[k])),
    [act, antes],
  );

  return (
    <div className="mcx-stage">
      {/* Varrimento curto na troca de ato: marca o corte como num vídeo. */}
      <span key={act.id} className="mcx-stage-sweep" aria-hidden="true" />

      <div className="mcx-stage-bar">
        <span className="mcx-dot" />
        <span className="mcx-mono">{act.label}</span>
        <span style={{ flex: 1 }} />
        <span className="mcx-stage-phase" data-f={fase}>
          {ROTULO_FASE[fase]}
        </span>
        <span className="mcx-mono mcx-stage-code">{act.reason}</span>
      </div>

      <div className="mcx-stage-grid">
        <ConversaPanel act={act} fase={fase} escrito={escrito} />
        <AgendaPanel slots={slots} mudou={mudou} aplicado={aplicado} />
        <CrmPanel
          coluna={coluna}
          viajando={Boolean(act.crmMoved) && aplicado}
          efeitos={act.effects ?? []}
          aplicado={aplicado}
        />
      </div>

      <div className="mcx-stage-trace" data-on={aplicado ? "true" : "false"}>
        <FantasmaTrace />
        <div className="mcx-h-live mcx-h-ghost-row">
          {act.trace.map((step, i) => (
            <span key={step} className="mcx-stage-step" style={{ ["--i" as string]: i }}>
              <span className="mcx-trace-idx">{String(i + 1).padStart(2, "0")}</span>
              {step}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ página */

export function AgendamentoView() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visivel, setVisivel] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const reduced = useReducedMotion();

  const sceneRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  /** Enquanto a coluna desliza sozinha, o scroll dela não pode redefinir o ato. */
  const deslizandoAte = useRef(0);

  const running = playing && visivel && !reduced;

  // Fora do ecrã não corre: senão a pessoa volta e a história já acabou.
  useEffect(() => {
    const check = () => {
      const el = sceneRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setVisivel(r.bottom > 120 && r.top < window.innerHeight - 120);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  // Relógio próprio: ao pausar e retomar, continua de onde parou.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (elapsed < ACT_MS) return;
    setElapsed(0);
    setActive((v) => (v + 1) % ACTS.length);
  }, [elapsed]);

  // Leva a coluna até o ato ativo. É este deslize que substitui o rolar do rato.
  useEffect(() => {
    const box = trackRef.current;
    const el = refs.current[active];
    if (!box || !el) return;
    // Alinhado ao TOPO, não ao centro: a coluna é mais alta que o ecrã em
    // muitos casos, e centrar deixava o ato ativo abaixo da dobra. Assim o
    // texto atual está sempre onde o olho vai, com o próximo a espreitar.
    const alvo = el.offsetTop - 20;
    deslizandoAte.current = Date.now() + 1000;
    box.scrollTo({ top: Math.max(0, alvo), behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  /**
   * Com a demonstração pausada, quem manda é a posição da coluna — o ato ativo
   * passa a ser o que está mais perto do topo dela, o mesmo ponto de referência
   * que o deslize automático usa. Se aqui fosse o centro, parar e voltar a
   * tocar saltaria um ato.
   */
  const aoRolarColuna = useCallback(() => {
    if (playing) return;
    if (Date.now() < deslizandoAte.current) return;
    const box = trackRef.current;
    if (!box) return;
    const topo = box.scrollTop + 20;
    let melhor = 0;
    let menor = Number.POSITIVE_INFINITY;
    refs.current.forEach((el, i) => {
      if (!el) return;
      const d = Math.abs(el.offsetTop - topo);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    });
    setActive(melhor);
  }, [playing]);

  /** Qualquer gesto dentro da coluna pausa e devolve o comando à pessoa. */
  const assumirControlo = useCallback(() => {
    setPlaying(false);
    setElapsed(0);
  }, []);

  const irPara = useCallback((i: number) => {
    setActive(((i % ACTS.length) + ACTS.length) % ACTS.length);
    setElapsed(0);
    setPlaying(false);
  }, []);

  const act = ACTS[active] ?? ACTS[0]!;
  /**
   * O que estava no ecrã antes deste ato. O palco anima a diferença entre os
   * dois — é daqui que sai o movimento do card e a mudança na agenda.
   */
  const antes = active === 0 ? ESTADO_INICIAL : (ACTS[active - 1] ?? ACTS[0]!);
  const pct = Math.min(100, (elapsed / ACT_MS) * 100);

  return (
    <McxPage>
      <McxNav />

      <main>
        {/* ---------------------------------------------------------------- */}
        <header style={{ position: "relative", overflow: "hidden" }}>
          <div className="mcx-grid" />
          <div
            className="mcx-aurora"
            style={{
              width: 620,
              height: 620,
              top: -320,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(242,68,0,.2)",
            }}
          />
          <div
            className="mcx-shell"
            style={{
              position: "relative",
              zIndex: 1,
              padding: "clamp(44px,6vw,80px) 24px clamp(20px,3vw,32px)",
              textAlign: "center",
            }}
          >
            <span className="mcx-chip" style={{ marginBottom: 22 }}>
              <span className="mcx-dot" />
              Agendamento automático
            </span>
            <h1 className="mcx-h1" style={{ maxWidth: 940, margin: "0 auto" }}>
              Ele marca, remarca e cancela.
              <br />
              <span className="mcx-accent">Você só aparece na hora.</span>
            </h1>
            <p className="mcx-lead" style={{ margin: "22px auto 0" }}>
              Um atendimento inteiro, do primeiro “oi” ao cancelamento. Corre sozinho — pause
              quando quiser ou avance no seu ritmo.
            </p>
          </div>
        </header>

        {/* ------------------------------------------------- separadores */}
        <div className="mcx-shell" style={{ paddingBottom: 8 }}>
          <div className="mcx-actbar" role="tablist" aria-label="Atos do agendamento">
            {ACTS.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                className={i === active ? "mcx-tab on" : "mcx-tab"}
                onClick={() => irPara(i)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------- cena */}
        <section className="mcx-shell mcx-scene" ref={sceneRef}>
          {/* Palco preso: reage ao ato ativo. */}
          <div className="mcx-scene-sticky">
            <Stage act={act} antes={antes} correndo={running} reduced={Boolean(reduced)} />

            <div className="mcx-scene-controls">
              <div className="mcx-player-progress" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="mcx-player-buttons">
                <button
                  type="button"
                  className="mcx-ctrl"
                  onClick={() => irPara(active - 1)}
                  aria-label="Ato anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="mcx-ctrl mcx-ctrl-play"
                  onClick={() => {
                    setPlaying((v) => !v);
                    setElapsed(0);
                  }}
                  aria-label={playing ? "Pausar demonstração" : "Retomar demonstração"}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                  <span>{playing ? "Pausar" : "Retomar"}</span>
                </button>
                <button
                  type="button"
                  className="mcx-ctrl"
                  onClick={() => irPara(active + 1)}
                  aria-label="Próximo ato"
                >
                  <ChevronRight size={16} />
                </button>
                <span className="mcx-mono mcx-scene-count">
                  {String(active + 1).padStart(2, "0")} / {String(ACTS.length).padStart(2, "0")}
                </span>
              </div>
            </div>
          </div>

          {/* Coluna do texto: desliza sozinha, e aceita a roda do rato a qualquer momento. */}
          <div
            className="mcx-acts-track"
            ref={trackRef}
            onScroll={aoRolarColuna}
            onWheel={assumirControlo}
            onTouchStart={assumirControlo}
          >
            <ol className="mcx-acts">
              {ACTS.map((a, i) => (
                <li
                  key={a.id}
                  id={`ato-${a.id}`}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  className={i === active ? "mcx-act is-on" : "mcx-act"}
                >
                  <span className="mcx-act-idx">
                    {String(i + 1).padStart(2, "0")} / {String(ACTS.length).padStart(2, "0")}
                  </span>
                  <h2 className="mcx-h2 mcx-act-title">{a.title}</h2>
                  <p className="mcx-body mcx-act-body">{a.body}</p>

                  {/* Espelho textual do palco: garante que quem não executa JS
                      (rastreadores de IA) lê a conversa e o efeito de cada ato. */}
                  <div className="mcx-act-mirror">
                    {a.inbound ? (
                      <p>
                        <b>Cliente:</b> {a.inbound}
                      </p>
                    ) : null}
                    {a.systemLine ? (
                      <p>
                        <b>Gatilho:</b> {a.systemLine}
                      </p>
                    ) : null}
                    <p>
                      <b>Agente:</b> {a.reply}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------- garantia */}
        <section style={{ padding: "clamp(50px,7vw,92px) 0" }}>
          <div className="mcx-shell">
            <Reveal>
              <SectionLabel>A trava</SectionLabel>
              <h2 className="mcx-h2">
                O agente não pode dizer que marcou
                <br />
                <span style={{ color: "var(--muted)" }}>se a agenda não registrou.</span>
              </h2>
              <p className="mcx-lead" style={{ marginTop: 18 }}>
                É o risco real de qualquer IA com agenda: o modelo escrever “pronto, agendei” sem
                que nada tenha sido gravado. O cliente aparece e não tem horário.
              </p>
            </Reveal>

            <Reveal delay={0.08}>
              <div
                className="mcx-card"
                style={{
                  marginTop: 30,
                  padding: "24px 26px",
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                  borderColor: "rgba(25,206,114,.3)",
                  background: "var(--live-dim)",
                }}
              >
                <ShieldCheck size={22} style={{ color: "var(--live)", flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p className="mcx-body" style={{ color: "var(--text)", fontSize: ".97rem" }}>
                    Se a resposta afirma que agendou mas o registro não aconteceu, o motor troca a
                    mensagem antes de sair:
                  </p>
                  <p
                    className="mcx-bubble mcx-bubble-out"
                    style={{ marginTop: 14, maxWidth: "100%" }}
                  >
                    Só um instante — ainda não registrei essa alteração na agenda. Me confirme a data
                    e o horário exatos (por exemplo: 20/07 às 14:00) que eu registro agora mesmo.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------- o que se configura */}
        <section style={{ padding: "0 0 clamp(50px,7vw,92px)" }}>
          <div className="mcx-shell">
            <Reveal>
              <SectionLabel>O que você decide</SectionLabel>
              <h2 className="mcx-h2">Nada disso é chute nosso.</h2>
              <p className="mcx-lead" style={{ marginTop: 16 }}>
                O agente só faz o que você configurou. Sem destino escolhido, o card nem se move.
              </p>
            </Reveal>

            <div className="mcx-pipe" style={{ marginTop: 34 }}>
              {[
                {
                  icon: Calendar,
                  title: "Sua janela de atendimento",
                  body: "Que dias da semana e de que hora a que hora você aceita. Fora disso o agente explica a janela em vez de marcar.",
                },
                {
                  icon: Bell,
                  title: "Até três lembretes",
                  body: "Minutos, horas ou dias antes, com a sua mensagem. Remarcou? Os antigos são cancelados e refeitos.",
                },
                {
                  icon: Cpu,
                  title: "Para onde o card vai",
                  body: "Funil e coluna ao marcar, e funil e coluna ao cancelar. São os dois únicos momentos em que o agente mexe no seu CRM.",
                },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <Reveal key={item.title} delay={i * 0.06}>
                    <article className="mcx-card mcx-node" style={{ height: "100%" }}>
                      <div className="mcx-node-top">
                        <span className="mcx-node-idx">{String(i + 1).padStart(2, "0")}</span>
                        <span className="mcx-node-ico">
                          <Icon size={16} />
                        </span>
                      </div>
                      <h3 className="mcx-h3">{item.title}</h3>
                      <p className="mcx-body">{item.body}</p>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- CTA */}
        <section style={{ padding: "0 0 clamp(66px,8vw,106px)" }}>
          <div className="mcx-shell">
            <Reveal>
              <div className="mcx-final">
                <div
                  className="mcx-aurora"
                  style={{
                    width: 460,
                    height: 460,
                    bottom: -290,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(242,68,0,.3)",
                  }}
                />
                <div style={{ position: "relative", zIndex: 1 }}>
                  <span className="mcx-chip" style={{ marginBottom: 22 }}>
                    <Sparkles size={12} style={{ color: "var(--brand-hi)" }} />
                    Sem ninguém de plantão
                  </span>
                  <h2 className="mcx-h2" style={{ maxWidth: 700, margin: "0 auto" }}>
                    Quantos horários você perdeu essa semana por demorar a responder?
                  </h2>
                  <p className="mcx-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                    O agente atende às três da manhã com a mesma agenda que você olha de manhã.
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
                      Ver os planos
                      <ArrowRight size={17} />
                    </Link>
                    <Link href="/#motor" className="mcx-btn mcx-btn-ghost mcx-btn-lg">
                      Como o agente decide
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <McxFooter />
    </McxPage>
  );
}
