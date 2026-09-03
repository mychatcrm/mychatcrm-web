"use client";

/**
 * Página de agendamento automático.
 *
 * Reconstruída do zero. A versão anterior era uma demonstração de dez atos que
 * corria a dez segundos cada: para ver a prova inteira a pessoa tinha de ficar
 * cem segundos à espera. Ninguém espera. A página mostrava-se a si própria em
 * vez de vender.
 *
 * O princípio agora é o oposto: NADA está atrás de um temporizador. As dez
 * situações estão todas no ecrã, em texto, de uma vez — o visitante lê a que
 * lhe interessa, no ritmo dele, e o botão está sempre a um scroll de distância.
 * Como efeito colateral, a prova toda passou a ser indexável ao mesmo tempo,
 * em vez de só o ato que estivesse ativo.
 *
 * A ordem também mudou. O argumento mais forte deste produto não é "responde
 * rápido" — é "não faz besteira na frente do seu cliente". Por isso as
 * situações em que o agente RECUSA vêm primeiro, e as promessas negativas têm
 * secção própria com o mecanismo ao lado, senão é só promessa.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  Check,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { McxFooter, McxNav, McxPage, Reveal, SectionLabel, groupDigits } from "@/components/marketing/mcx";
import { NUNCA, PASSOS, PERGUNTAS, SITUACOES, type Situacao, type TipoSituacao } from "./conteudo";
import { DemoAoVivo } from "./DemoAoVivo";

const CTA = "/planos";

/* ------------------------------------------------------------------- prova */

/** Uma situação, inteira e legível de uma vez. */
function CartaoSituacao({ s }: { s: Situacao }) {
  const protege = s.tipo === "protege";
  return (
    <article className="mcx-sit" id={`situacao-${s.id}`} data-t={s.tipo}>
      <header className="mcx-sit-top">
        <span className="mcx-sit-mark" aria-hidden="true">
          {protege ? <ShieldCheck size={13} /> : <Check size={13} strokeWidth={3} />}
        </span>
        <h3 className="mcx-sit-tag">{s.tag}</h3>
        <span className="mcx-sit-code mcx-mono">{s.motivo}</span>
      </header>

      <div className="mcx-sit-talk">
        {s.gatilho ? (
          <p className="mcx-sit-trigger">
            <Bell size={11} />
            {s.gatilho}
          </p>
        ) : null}
        {s.pergunta ? (
          <p className="mcx-bubble mcx-bubble-in">
            <span className="mcx-sit-who">Cliente</span>
            {s.pergunta}
          </p>
        ) : null}
        <p className="mcx-bubble mcx-bubble-out">
          <span className="mcx-sit-who">Agente</span>
          {s.resposta}
        </p>
      </div>

      <ul className="mcx-sit-did">
        {s.fez.map((f) => (
          <li key={f}>
            <Check size={11} strokeWidth={3} />
            {f}
          </li>
        ))}
      </ul>
    </article>
  );
}

/* -------------------------------------------------------------- calculadora */

/**
 * O custo do agendamento à mão, nos números de quem está a ler.
 *
 * Só conta o que a pessoa mesma informa — nada de estatística inventada de
 * mercado, que é o tipo de número que destrói a confiança quando alguém
 * confere.
 */
function Calculadora() {
  const [porSemana, setPorSemana] = useState(25);
  const [minutos, setMinutos] = useState(6);

  const { horasMes, diasAno } = useMemo(() => {
    const minutosMes = porSemana * minutos * 4.33;
    return {
      horasMes: Math.round(minutosMes / 60),
      diasAno: Math.round((minutosMes * 12) / 60 / 8),
    };
  }, [porSemana, minutos]);

  return (
    <div className="mcx-calc">
      {/* Mesmos controlos da calculadora da página inicial: quem vem de lá
          reconhece a peça em vez de aprender outra. */}
      <div>
        <label className="mcx-field">
          <span className="mcx-field-top">
            <span className="mcx-field-lbl">Agendamentos por semana</span>
            <span className="mcx-field-val">{groupDigits(porSemana)}</span>
          </span>
          <input
            type="range"
            min={5}
            max={200}
            step={5}
            value={porSemana}
            onChange={(e) => setPorSemana(Number(e.target.value))}
            aria-label="Agendamentos por semana"
          />
        </label>

        <label className="mcx-field">
          <span className="mcx-field-top">
            <span className="mcx-field-lbl">Minutos de ida e volta em cada um</span>
            <span className="mcx-field-val">{minutos} min</span>
          </span>
          <input
            type="range"
            min={2}
            max={30}
            step={1}
            value={minutos}
            onChange={(e) => setMinutos(Number(e.target.value))}
            aria-label="Minutos por agendamento"
          />
        </label>

        <p className="mcx-calc-note">
          Conta só o vaivém para marcar: perguntar o dia, conferir a agenda, confirmar e lembrar.
          Não conta o atendimento em si.
        </p>
      </div>

      <div className="mcx-readout">
        <span className="mcx-mono">Agendar à mão custa</span>
        <span className="mcx-readout-big">{groupDigits(horasMes)} h</span>
        <span className="mcx-field-lbl">por mês, só em mensagens de marcação</span>

        <div className="mcx-readout-split">
          <div className="mcx-readout-cell">
            <span className="mcx-mono">Por ano</span>
            <strong>{groupDigits(diasAno)} dias de trabalho</strong>
          </div>
          <div className="mcx-readout-cell">
            <span className="mcx-mono">Com o agente</span>
            <strong>Ele responde todas</strong>
          </div>
        </div>

        <Link href={CTA} className="mcx-btn mcx-btn-primary mcx-calc-cta">
          Ver planos
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ página */

const FILTROS: { chave: TipoSituacao | "todas"; nome: string; nota: string }[] = [
  { chave: "todas", nome: "Todas", nota: "As dez situações" },
  { chave: "protege", nome: "Quando ele recusa", nota: "Protege a sua agenda" },
  { chave: "resolve", nome: "Quando ele resolve", nota: "Executa sozinho" },
];

export function AgendamentoView() {
  const [filtro, setFiltro] = useState<TipoSituacao | "todas">("todas");
  const lista = filtro === "todas" ? SITUACOES : SITUACOES.filter((s) => s.tipo === filtro);
  const nProtege = SITUACOES.filter((s) => s.tipo === "protege").length;

  return (
    <McxPage>
      <McxNav />

      {/* ---------------------------------------------------------- hero --- */}
      <header className="mcx-shell mcx-ag-hero">
        <div className="mcx-ag-hero-text">
          <SectionLabel>Agendamento automático</SectionLabel>
          <h1 className="mcx-h1">
            Ele marca, remarca e cancela pelo WhatsApp.
            <em> Você só aparece na hora.</em>
          </h1>
          <p className="mcx-lead">
            Um agente que confere a sua agenda de verdade antes de prometer qualquer coisa — e que
            prefere recusar a marcar besteira na frente do seu cliente.
          </p>

          <div className="mcx-ag-cta">
            <Link href={CTA} className="mcx-btn mcx-btn-primary">
              Ver planos
              <ArrowRight size={16} />
            </Link>
            <a href="#situacoes" className="mcx-btn mcx-btn-ghost">
              Ver as 10 situações
            </a>
          </div>

          <ul className="mcx-ag-trust">
            <li>
              <ShieldCheck size={13} /> Confere a agenda antes de confirmar
            </li>
            <li>
              <CalendarCheck size={13} /> Não grava nada sem o sim do cliente
            </li>
            <li>
              <Bell size={13} /> Lembretes e avisos automáticos
            </li>
          </ul>
        </div>

        {/* A demonstração ao vivo. É o que prova, em movimento, que isto é um
            produto de IA — mas nada na página fica atrás dela: a prova completa
            de cada situação está em texto na grelha, logo abaixo. */}
        <DemoAoVivo />
      </header>

      {/* ----------------------------------------------------- reconhecer --- */}
      <section className="mcx-shell mcx-ag-dor">
        <Reveal>
          <div className="mcx-ag-dor-grid">
            {[
              "Mensagem às 22h que só é vista de manhã — e até lá a pessoa marcou noutro lugar.",
              "O vaivém de sempre: “que dia?”, “esse não dá”, “e quinta?”, quatro horas depois.",
              "Dois marcados no mesmo horário porque duas conversas andaram ao mesmo tempo.",
            ].map((t) => (
              <p key={t} className="mcx-ag-dor-item">
                <X size={14} />
                {t}
              </p>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ------------------------------------------------------ situações --- */}
      <section className="mcx-shell mcx-sec" id="situacoes">
        <Reveal>
          <SectionLabel>A prova</SectionLabel>
          <h2 className="mcx-h2">
            As 10 situações que um cliente cria — e o que o agente responde em cada uma.
          </h2>
          <p className="mcx-lead mcx-lead-tight">
            As respostas abaixo são o texto que o agente devolve de verdade, com o código interno da
            decisão ao lado. {nProtege} das 10 são situações em que ele <strong>recusa</strong> e
            explica: é aí que a sua agenda fica protegida.
          </p>
        </Reveal>

        <Reveal>
          <div className="mcx-filtros" role="tablist" aria-label="Filtrar situações">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                role="tab"
                aria-selected={filtro === f.chave}
                className="mcx-filtro"
                data-on={filtro === f.chave ? "true" : "false"}
                onClick={() => setFiltro(f.chave)}
              >
                {f.nome}
                <small>{f.nota}</small>
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mcx-sits">
          {lista.map((s) => (
            <CartaoSituacao key={s.id} s={s} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- nunca --- */}
      <section className="mcx-shell mcx-sec" id="garantias">
        <Reveal>
          <SectionLabel>O que ele nunca faz</SectionLabel>
          <h2 className="mcx-h2">O medo não é o robô ser lento. É ele marcar besteira.</h2>
        </Reveal>
        <div className="mcx-nunca">
          {NUNCA.map((n) => (
            <Reveal key={n.titulo}>
              <div className="mcx-nunca-item">
                <h3>
                  <ShieldCheck size={15} />
                  {n.titulo}
                </h3>
                <p>{n.como}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- passos --- */}
      <section className="mcx-shell mcx-sec">
        <Reveal>
          <SectionLabel>Para ligar</SectionLabel>
          <h2 className="mcx-h2">Três passos, uma vez só.</h2>
        </Reveal>
        <div className="mcx-passos">
          {PASSOS.map((p) => (
            <Reveal key={p.n}>
              <div className="mcx-passo">
                <span className="mcx-mono mcx-passo-n">{p.n}</span>
                <h3>{p.titulo}</h3>
                <p>{p.texto}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- conta --- */}
      <section className="mcx-shell mcx-sec">
        <Reveal>
          <SectionLabel>A conta</SectionLabel>
          <h2 className="mcx-h2">Quanto o agendamento à mão custa por mês.</h2>
        </Reveal>
        <Reveal>
          <Calculadora />
        </Reveal>
      </section>

      {/* ------------------------------------------------------------ faq --- */}
      <section className="mcx-shell mcx-sec" id="faq">
        <Reveal>
          <SectionLabel>Perguntas</SectionLabel>
          <h2 className="mcx-h2">O que costumam perguntar antes de ligar.</h2>
        </Reveal>
        <div className="mcx-faq">
          {PERGUNTAS.map((p) => (
            <details key={p.q} className="mcx-faq-item">
              <summary>{p.q}</summary>
              <p>{p.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ cta --- */}
      <section className="mcx-shell mcx-sec">
        <Reveal>
          <div className="mcx-cta-final">
            <Sparkles size={20} />
            <h2 className="mcx-h2">Enquanto você lia isto, alguém mandou mensagem.</h2>
            <p className="mcx-lead">
              O agente responde na hora, confere a agenda e confirma. Você só aparece no horário
              marcado.
            </p>
            <Link href={CTA} className="mcx-btn mcx-btn-primary mcx-btn-lg">
              Ver planos
              <ArrowRight size={17} />
            </Link>
          </div>
        </Reveal>
      </section>

      <McxFooter />

      {/* Barra fixa no telemóvel: o botão nunca sai do alcance do polegar. */}
      <div className="mcx-sticky">
        <span>Agendamento automático no seu WhatsApp</span>
        <Link href={CTA} className="mcx-btn mcx-btn-primary">
          Ver planos
        </Link>
      </div>
    </McxPage>
  );
}
