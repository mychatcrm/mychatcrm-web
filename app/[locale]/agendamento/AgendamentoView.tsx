"use client";

/**
 * Página do agendamento automático.
 *
 * A cena avança com o SCROLL, não com um relógio. Cada ato é um bloco de texto
 * real na coluna da esquerda — indexável pelo Google e legível pelos
 * rastreadores de IA que não executam JS — e o palco da direita fica preso
 * (sticky) a reagir ao ato ativo. Sem JS, o texto todo continua lá e o palco
 * mostra o primeiro ato: nada fica invisível.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  Cpu,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { McxFooter, McxNav, McxPage, Reveal, SectionLabel } from "@/components/marketing/mcx";
import { ACTS, AGENDA_DAYS, AGENDA_HOURS, CRM_COLUMNS, type Act } from "./acts";

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

function Stage({ act }: { act: Act }) {
  return (
    <div className="mcx-stage">
      <div className="mcx-stage-bar">
        <span className="mcx-dot" />
        <span className="mcx-mono">{act.label}</span>
        <span style={{ flex: 1 }} />
        <span className="mcx-mono mcx-stage-code">{act.reason}</span>
      </div>

      <div className="mcx-stage-grid">
        <ConversaPanel act={act} />
        <AgendaPanel act={act} />
        <CrmPanel act={act} />
      </div>

      <div className="mcx-stage-trace">
        {act.trace.map((step, i) => (
          <span key={step} className="mcx-stage-step">
            <span className="mcx-trace-idx">{String(i + 1).padStart(2, "0")}</span>
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ página */

export function AgendamentoView() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  /**
   * Enquanto o scroll suave de um clique está a decorrer, o recálculo fica
   * travado. Sem isto o listener corrige o ato de volta a meio do caminho e o
   * separador que a pessoa acabou de clicar "salta" para trás.
   */
  const travadoAte = useRef(0);

  /**
   * Ato ativo = aquele cujo meio está mais perto do centro do ecrã. Mais
   * estável que fatiar o scroll por fração: funciona com atos de alturas
   * diferentes e não descalibra quando o texto quebra em mais linhas.
   */
  const recompute = useCallback(() => {
    if (Date.now() < travadoAte.current) return;
    const alvo = window.innerHeight * 0.5;
    let melhor = 0;
    let menor = Number.POSITIVE_INFINITY;
    refs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - alvo);
      if (d < menor) {
        menor = d;
        melhor = i;
      }
    });
    setActive(melhor);
  }, []);

  useEffect(() => {
    recompute();
    window.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  const irPara = (i: number) => {
    // O palco muda já, sem esperar o scroll suave terminar: o clique tem de
    // responder na hora.
    setActive(i);
    travadoAte.current = Date.now() + 900;
    refs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const act = ACTS[active] ?? ACTS[0]!;

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
              padding: "clamp(48px,7vw,88px) 24px clamp(26px,4vw,40px)",
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
              Role a página e acompanhe um atendimento inteiro — do primeiro “oi” ao cancelamento —
              com a conversa, a sua agenda e o card no CRM reagindo ao mesmo tempo.
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
        <section className="mcx-shell mcx-scene">
          {/* Palco preso: reage ao ato ativo. */}
          <div className="mcx-scene-sticky">
            <Stage act={act} />
          </div>

          {/* Coluna do texto: cada ato é conteúdo real, sempre no HTML. */}
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
