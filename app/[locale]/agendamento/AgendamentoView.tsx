"use client";

/**
 * Página do agendamento automático.
 *
 * A cena toca sozinha, como um player: a legenda vive DENTRO do palco e muda
 * com ele. Ligar um temporizador mantendo o texto numa coluna a rolar faria os
 * dois brigarem — a pessoa ainda a ler o ato 5 e o palco já no 7.
 *
 * Controlo total de quem vê: pausa, anterior/seguinte e salto por ato. Mexer à
 * mão pausa; o botão retoma. Fora do ecrã não corre, e quem tem "reduzir
 * movimento" ligado não recebe avanço automático nenhum.
 *
 * Abaixo do player os dez atos ficam em texto corrido: é o que o Google e os
 * rastreadores de IA leem, e o que serve a quem prefere ler tudo de uma vez.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
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
import { ACTS, AGENDA_DAYS, AGENDA_HOURS, CRM_COLUMNS, type Act } from "./acts";

/** Tempo de cada ato. Dá para ler título, explicação e conversa sem correr. */
const ACT_MS = 10_000;
const TICK_MS = 250;

/* ------------------------------------------------------------------ palco */

function ConversaPanel({ act }: { act: Act }) {
  return (
    <div className="mcx-stage-panel">
      <div className="mcx-stage-head">
        <MessageSquare size={13} />
        <span>Conversa no WhatsApp</span>
      </div>
      <div className="mcx-stage-body mcx-stage-thread">
        {act.systemLine ? (
          <div className="mcx-console-system">
            <i />
            <span>{act.systemLine}</span>
            <i />
          </div>
        ) : null}
        {act.inbound ? (
          <div className="mcx-bubble mcx-bubble-in mcx-stage-anim">{act.inbound}</div>
        ) : null}
        <div className="mcx-bubble mcx-bubble-out mcx-stage-anim mcx-stage-anim-2">{act.reply}</div>
      </div>
    </div>
  );
}

function AgendaPanel({ act }: { act: Act }) {
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
            <Fragmentish key={h} hour={h} act={act} />
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
}

/** Uma linha da grelha (hora + os quatro dias). */
function Fragmentish({ hour, act }: { hour: string; act: Act }) {
  return (
    <>
      <span className="mcx-agenda-hour">{hour}</span>
      {AGENDA_DAYS.map((day) => {
        const state = act.slots[`${day}-${hour}`] ?? "livre";
        return <span key={day} className="mcx-agenda-slot" data-s={state} aria-label={`${day} ${hour}: ${state}`} />;
      })}
    </>
  );
}

function CrmPanel({ act }: { act: Act }) {
  return (
    <div className="mcx-stage-panel">
      <div className="mcx-stage-head">
        <Cpu size={13} />
        <span>Card no CRM</span>
      </div>
      <div className="mcx-stage-body">
        <div className="mcx-crm-board">
          {CRM_COLUMNS.map((col, i) => (
            <div key={col} className="mcx-crm-col" data-on={i === act.crmColumn ? "true" : "false"}>
              <span className="mcx-crm-colname">{col}</span>
              {i === act.crmColumn ? (
                <div className={act.crmMoved ? "mcx-crm-card is-moving" : "mcx-crm-card"}>
                  <span className="mcx-crm-name">Marina</span>
                  <span className="mcx-crm-meta">atendimento</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {act.effects?.length ? (
          <ul className="mcx-effects">
            {act.effects.map((e) => (
              <li key={e}>
                <Check size={12} strokeWidth={3} />
                {e}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Stage({ act, index }: { act: Act; index: number }) {
  return (
    <div className="mcx-stage-grid">
      {/* A legenda vive dentro do palco: é o que muda junto com os painéis. */}
      <div className="mcx-stage-caption">
        <span className="mcx-act-idx">
          Ato {String(index + 1).padStart(2, "0")} / {String(ACTS.length).padStart(2, "0")}
        </span>
        <h2 className="mcx-h2 mcx-act-title">{act.title}</h2>
        <p className="mcx-body mcx-act-body">{act.body}</p>
        <div className="mcx-stage-trace">
          {act.trace.map((step, i) => (
            <span key={step} className="mcx-stage-step">
              <span className="mcx-trace-idx">{String(i + 1).padStart(2, "0")}</span>
              {step}
            </span>
          ))}
        </div>
      </div>

      <div className="mcx-stage-panels">
        <ConversaPanel act={act} />
        <AgendaPanel act={act} />
        <CrmPanel act={act} />
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
  const playerRef = useRef<HTMLDivElement>(null);

  /** Só corre quando alguém pode estar a ver. */
  const running = playing && visivel && !reduced;

  // Fora do ecrã não avança: senão o visitante volta e a história já acabou.
  useEffect(() => {
    const check = () => {
      const el = playerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setVisivel(r.bottom > 100 && r.top < window.innerHeight - 100);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  // Relógio próprio em vez de animação CSS: ao pausar e retomar, a barra e o
  // avanço continuam de onde pararam em vez de recomeçarem do zero.
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

  /** Mexer à mão pausa — quem escolheu um ato quer ficar nele. */
  const irPara = useCallback((i: number) => {
    setActive(((i % ACTS.length) + ACTS.length) % ACTS.length);
    setElapsed(0);
    setPlaying(false);
  }, []);

  const act = ACTS[active] ?? ACTS[0]!;
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
              padding: "clamp(44px,6vw,80px) 24px clamp(22px,3vw,34px)",
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
              Um atendimento inteiro, do primeiro “oi” ao cancelamento. A demonstração corre
              sozinha — pause quando quiser ou avance no seu ritmo.
            </p>
          </div>
        </header>

        {/* ------------------------------------------------- player */}
        <section className="mcx-shell" style={{ paddingBottom: "clamp(40px,6vw,72px)" }}>
          <div className="mcx-player" ref={playerRef}>
            <div className="mcx-player-bar">
              <span className={running ? "mcx-dot" : "mcx-dot is-paused"} />
              <span className="mcx-mono">{act.label}</span>
              <span style={{ flex: 1 }} />
              <span className="mcx-mono mcx-stage-code">{act.reason}</span>
            </div>

            <div className="mcx-player-progress" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>

            <Stage act={act} index={active} />

            <div className="mcx-player-controls">
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
                    if (!playing) setElapsed(0);
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
              </div>

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
          </div>
        </section>

        {/* ------------------------------------------------- os dez atos em texto */}
        <section style={{ padding: "0 0 clamp(50px,7vw,92px)" }}>
          <div className="mcx-shell">
            <Reveal>
              <SectionLabel>O ciclo inteiro</SectionLabel>
              <h2 className="mcx-h2">Os dez momentos, de uma vez.</h2>
              <p className="mcx-lead" style={{ marginTop: 16 }}>
                Cada resposta abaixo é a que o agente realmente envia naquele momento.
              </p>
            </Reveal>

            <ol className="mcx-acts">
              {ACTS.map((a, i) => (
                <li key={a.id} id={`ato-${a.id}`} className="mcx-act">
                  <button type="button" className="mcx-act-jump" onClick={() => irPara(i)}>
                    <span className="mcx-act-idx">
                      {String(i + 1).padStart(2, "0")} · {a.label}
                    </span>
                    <h3 className="mcx-h3 mcx-act-title">{a.title}</h3>
                  </button>
                  <p className="mcx-body mcx-act-body">{a.body}</p>
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
        <section style={{ padding: "0 0 clamp(50px,7vw,92px)" }}>
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
                  <p className="mcx-bubble mcx-bubble-out" style={{ marginTop: 14, maxWidth: "100%" }}>
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
