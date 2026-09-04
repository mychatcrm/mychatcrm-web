"use client";

/**
 * A demonstração ao vivo do hero.
 *
 * UMA conversa que cresce no ecrã, com a agenda e o CRM a reagir enquanto o
 * agente decide. As mensagens acumulam e a fila rola sozinha para o fim, como
 * num WhatsApp de verdade — foi o que faltou nas versões anteriores, que
 * limpavam o palco a cada situação e nunca deixavam ver uma história inteira.
 *
 * Três coisas ficam visíveis ao mesmo tempo, e é isso que dá a impressão de
 * máquina a trabalhar: o agente a escrever, o horário a ser reservado na
 * grelha, e o card a VIAJAR de coluna no CRM (o Framer mede de onde para onde
 * e faz o percurso).
 *
 * Nada na página depende disto. Quem chega, pausa, ou tem "reduzir movimento"
 * ligado continua a ter todo o argumento em texto à volta. A animação convence;
 * o texto explica.
 *
 * Vive em components/marketing porque é usada em mais do que uma página: na de
 * agendamento e na lista de espera, onde é a prova de que o produto existe.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bell, Calendar, Check, Cpu, MessageSquare, Pause, Play } from "lucide-react";
import {
  AGENDA_INICIAL,
  CICLO_MS,
  COLUNAS_CRM,
  DIAS,
  GUIAO,
  HORAS,
  MS_A_ESCREVER,
  MS_POR_CHAR,
  fimDoGuiao,
  type EstadoSlot,
} from "./demo-agente";

const TICK_MS = 50;

/** Quando a fala de uma batida acaba de ser escrita. */
function fimDaBatida(i: number): number {
  const b = GUIAO[i]!;
  return b.quem === "agente" ? b.t + b.texto.length * MS_POR_CHAR : b.t;
}

export function DemoAoVivo() {
  const reduzido = useReducedMotion();
  const [t, setT] = useState(0);
  const [tocando, setTocando] = useState(true);
  const [noEcra, setNoEcra] = useState(false);

  const caixa = useRef<HTMLDivElement>(null);
  const fila = useRef<HTMLDivElement>(null);

  const correndo = tocando && noEcra && !reduzido;

  // Fora do ecrã não corre: senão a pessoa chega e a história já acabou.
  useEffect(() => {
    const ver = () => {
      const el = caixa.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setNoEcra(r.bottom > 60 && r.top < window.innerHeight - 60);
    };
    ver();
    window.addEventListener("scroll", ver, { passive: true });
    window.addEventListener("resize", ver);
    return () => {
      window.removeEventListener("scroll", ver);
      window.removeEventListener("resize", ver);
    };
  }, []);

  useEffect(() => {
    if (!correndo) return;
    const id = setInterval(() => setT((v) => (v + TICK_MS) % CICLO_MS), TICK_MS);
    return () => clearInterval(id);
  }, [correndo]);

  // Quem não quer movimento vê o fim da história, já resolvida.
  const agora = reduzido ? fimDoGuiao() : t;

  /** O que está no ecrã neste instante. */
  const cena = useMemo(() => {
    const agenda: Record<string, EstadoSlot> = { ...AGENDA_INICIAL };
    let crm: number | null = null;
    let efeitos: string[] = [];
    let piscar: string[] = [];

    for (let i = 0; i < GUIAO.length; i += 1) {
      const b = GUIAO[i]!;
      const fim = fimDaBatida(i);
      if (agora < fim) break;
      if (b.agenda) {
        Object.assign(agenda, b.agenda);
        if (agora - fim < 900) piscar = Object.keys(b.agenda);
      }
      if (b.crm !== undefined) crm = b.crm;
      if (b.efeitos) efeitos = b.efeitos;
    }

    const ditas = GUIAO.map((b, i) => ({ b, i })).filter(({ b }) => agora >= b.t);
    const aEscrever = GUIAO.some(
      (b) => b.quem === "agente" && agora >= b.t - MS_A_ESCREVER && agora < b.t,
    );

    return { agenda, crm, efeitos, piscar, ditas, aEscrever };
  }, [agora]);

  const ultima = cena.ditas[cena.ditas.length - 1];
  const escritoAgora = ultima
    ? ultima.b.quem === "agente"
      ? Math.min(ultima.b.texto.length, Math.floor((agora - ultima.b.t) / MS_POR_CHAR))
      : ultima.b.texto.length
    : 0;

  // A fila acompanha a última mensagem, como qualquer conversa.
  useEffect(() => {
    const el = fila.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cena.ditas.length, escritoAgora, cena.aEscrever]);

  const pct = reduzido ? 100 : (agora / CICLO_MS) * 100;

  return (
    <div className="mcx-live" ref={caixa}>
      <div className="mcx-live-bar">
        <span className="mcx-dot" />
        <span className="mcx-mono">Agente ao vivo</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="mcx-live-play"
          onClick={() => setTocando((v) => !v)}
          aria-label={tocando ? "Pausar demonstração" : "Retomar demonstração"}
        >
          {tocando ? <Pause size={11} /> : <Play size={11} />}
          {tocando ? "Pausar" : "Tocar"}
        </button>
      </div>

      <span className="mcx-live-prog" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>

      {/* a conversa */}
      <div className="mcx-live-sec">
        <p className="mcx-live-head">
          <MessageSquare size={12} />
          Conversa no WhatsApp
        </p>
        <div className="mcx-live-thread" ref={fila}>
          {cena.ditas.map(({ b, i }) => {
            const derradeira = i === ultima?.i;
            const texto = derradeira ? b.texto.slice(0, escritoAgora) : b.texto;
            if (b.quem === "sistema") {
              return (
                <p key={i} className="mcx-live-sys">
                  <Bell size={10} />
                  {texto}
                </p>
              );
            }
            return (
              <p
                key={i}
                className={b.quem === "lead" ? "mcx-bubble mcx-bubble-in" : "mcx-bubble mcx-bubble-out"}
              >
                {texto}
                {derradeira && b.quem === "agente" && escritoAgora < b.texto.length ? (
                  <i className="mcx-caret" />
                ) : null}
              </p>
            );
          })}

          {cena.aEscrever ? (
            <span className="mcx-bubble mcx-bubble-out mcx-live-dots" aria-label="O agente está a escrever">
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </div>
      </div>

      {/* agenda + crm */}
      <div className="mcx-live-panels">
        <div className="mcx-live-sec">
          <p className="mcx-live-head">
            <Calendar size={12} />
            Sua agenda
          </p>
          <div className="mcx-live-grid">
            <span />
            {DIAS.map((d) => (
              <span key={d} className="mcx-live-day">
                {d}
              </span>
            ))}
            {HORAS.map((h) => (
              <LinhaAgenda key={h} hora={h} agenda={cena.agenda} piscar={cena.piscar} />
            ))}
          </div>
        </div>

        <div className="mcx-live-sec">
          <p className="mcx-live-head">
            <Cpu size={12} />
            Card no CRM
          </p>
          <div className="mcx-live-board">
            {COLUNAS_CRM.map((col, i) => (
              <div key={col} className="mcx-live-col" data-on={i === cena.crm ? "true" : "false"}>
                <span className="mcx-live-colname">{col}</span>
                {i === cena.crm ? (
                  <motion.div
                    layoutId="mcx-demo-card"
                    className="mcx-live-card"
                    transition={{ type: "spring", stiffness: 220, damping: 26, mass: 0.9 }}
                  >
                    Marina
                  </motion.div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <ul className="mcx-live-fx" data-on={cena.efeitos.length ? "true" : "false"}>
        {(cena.efeitos.length ? cena.efeitos : ["", "", "", ""]).map((e, i) => (
          <li key={`${e}-${i}`} style={{ ["--i" as string]: i }} aria-hidden={e ? undefined : true}>
            {e ? (
              <>
                <Check size={11} strokeWidth={3} />
                {e}
              </>
            ) : (
              <span>&nbsp;</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinhaAgenda({
  hora,
  agenda,
  piscar,
}: {
  hora: string;
  agenda: Record<string, EstadoSlot>;
  piscar: string[];
}) {
  return (
    <>
      <span className="mcx-live-hour">{hora}</span>
      {DIAS.map((dia) => {
        const chave = `${dia}-${hora}`;
        return (
          <span
            key={dia}
            className="mcx-live-slot"
            data-s={agenda[chave] ?? "livre"}
            data-flash={piscar.includes(chave) ? "true" : undefined}
            aria-label={`${dia} ${hora}: ${agenda[chave] ?? "livre"}`}
          />
        );
      })}
    </>
  );
}
