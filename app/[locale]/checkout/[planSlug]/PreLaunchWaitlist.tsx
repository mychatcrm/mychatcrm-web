"use client";

/**
 * Lista de espera que substitui o checkout enquanto o produto está em testes.
 *
 * TEMPORÁRIO E REVERSÍVEL: quem decide se esta página aparece é a flag
 * `platform_launch_config.pre_launch_popup_enabled`, no toggle de
 * /admin/leads-lancamento. Desligar devolve o checkout Stripe exatamente como
 * estava — o `CheckoutView` e as rotas de pagamento não foram tocados.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Percent,
  Rocket,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { checkWhatsapp, formatWhatsapp } from "@/lib/brazil-whatsapp";
import { BLOG_NICHES } from "@/lib/blog/posts";
import { McxFooter, McxNav, McxPage, Reveal, SectionLabel, priceBRL } from "@/components/marketing/mcx";
import { DemoAoVivo } from "@/components/marketing/DemoAoVivo";

const LAUNCH_TARGET = "Dezembro de 2026";

/** O que estamos a terminar. Cada item existe no produto — nada aqui é promessa vaga. */
const BUILDING = [
  {
    title: "Um agente que decide, não que segue roteiro",
    body: "Ele lê a conversa inteira, junta as mensagens em rajada, entende áudio e imagem e escolhe o próximo passo a cada mensagem. Chatbot de árvore de botões é outra categoria.",
  },
  {
    title: "CRM, agenda e follow-up no mesmo lugar",
    body: "O cartão anda de coluna sozinho, o compromisso entra na agenda com o horário conferido e o follow-up volta sozinho quando o lead some. Sem colar três ferramentas com fita.",
  },
  {
    title: "Ligado ao seu próprio sistema",
    body: "O agente consulta o seu estoque, a sua tabela, a sua base — por conectores que você declara. Ele responde com o seu dado real, não com o que inventou.",
  },
  {
    title: "Testado como quem opera dinheiro dos outros",
    body: "Um milhão de cenários de decisão rodam todos os dias no nosso pipeline, mais teste de mutação nos módulos de autorização. É por isso que estamos a demorar.",
  },
] as const;

const PLAN_LABEL: Record<string, string> = {
  solo: "Solo",
  equipa: "Equipa",
  escala: "Escala",
  enterprise: "Enterprise",
};

type Props = {
  planSlug: string;
  planName: string;
  priceMonthly: number | null;
  billingCycle: "monthly" | "annual";
};

export function PreLaunchWaitlist({ planSlug, planName, priceMonthly, billingCycle }: Props) {
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [segment, setSegment] = useState("");
  const [otherSegment, setOtherSegment] = useState("");
  const [website, setWebsite] = useState(""); // armadilha para bots
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Os segmentos vêm dos guias do blog — é a lista que já descreve o produto. */
  const segments = useMemo(() => {
    const unique = [...new Set(BLOG_NICHES)].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return unique.map((n) => n.charAt(0).toUpperCase() + n.slice(1));
  }, []);

  const validate = () => {
    const next: Record<string, string> = {};
    if (fullName.trim().length < 2) next.fullName = "Diga seu nome completo.";
    const phone = checkWhatsapp(whatsapp);
    if (!phone.ok) next.whatsapp = phone.message;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "Informe um e-mail válido.";
    const chosen = segment === "__outro" ? otherSegment.trim() : segment;
    if (!chosen) next.segment = "Escolha o que descreve melhor o seu negócio.";
    setErrors(next);
    return { valid: Object.keys(next).length === 0, chosen };
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { valid, chosen } = validate();
    if (!valid) return;

    setSending(true);
    setFailure(null);
    try {
      const res = await fetch("/api/pre-launch-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          whatsapp,
          email: email.trim(),
          businessDescription: chosen,
          source: "buy",
          planSlug,
          billingCycle,
          website,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setFailure(data?.error ?? "Não foi possível salvar agora. Tente de novo.");
        return;
      }
      setDone(true);
    } catch {
      setFailure("Falha de conexão. Tente de novo em instantes.");
    } finally {
      setSending(false);
    }
  };

  const cycleLabel = billingCycle === "annual" ? "anual" : "mensal";

  return (
    <McxPage>
      {/* Nesta página o botão do topo não pode devolver a pessoa aos planos: ela
          veio de lá. Aponta para o formulário, que é o único objetivo daqui. */}
      <McxNav compact ctaHref="#mcx-waitlist-form" ctaLabel="Entrar na lista" />

      <main>
        {/* ---------------------------------------------------------------- */}
        <header style={{ position: "relative", overflow: "hidden" }}>
          <div className="mcx-grid" />
          <div
            className="mcx-aurora"
            style={{
              width: 640,
              height: 640,
              top: -320,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(242,68,0,.22)",
            }}
          />

          <div
            className="mcx-shell"
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gap: "clamp(34px,5vw,60px)",
              padding: "clamp(40px,6vw,76px) 24px clamp(50px,7vw,84px)",
              alignItems: "start",
            }}
            id="mcx-waitlist-grid"
          >
            {/* --- coluna do argumento --- */}
            <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 640 }}>
              {/*
                A manchete vende o resultado, não a lista de espera — a mesma fórmula
                da /agendamento. "Você chegou antes / E isso vai valer a pena" falava
                da fila e não prometia nada que se possa cobrar; esta toca na dor que
                traz a pessoa até aqui, e a condição fica na linha de baixo.
              */}
              {/* Corpo menor que o da home: a manchete é mais longa e a 3,4rem
                  partia em quatro linhas, com o corte feio em "por demorar a /
                  responder". A 2,9rem cabe em duas, uma por linha da frase. */}
              <h1 className="mcx-h1" style={{ fontSize: "clamp(1.95rem,3.6vw,2.9rem)" }}>
                Nunca mais perca um cliente
                <br />
                <span className="mcx-accent">por demorar a responder.</span>
              </h1>

              {/*
                Aqui havia dois parágrafos cinzentos que falavam de NÓS — "preferimos
                segurar, terminar direito". Ninguém lê isso numa página de captura, e
                era o que o Renato apontou: apagado e fraco.

                Agora são três linhas curtas sobre o que a PESSOA leva por entrar, e
                logo a seguir a demonstração ao vivo. Numa página que pede o WhatsApp de
                alguém sem ter checkout, a pergunta silenciosa é "isto existe mesmo?" —
                e um agente a trabalhar à frente dela responde melhor do que prosa.
              */}
              <p className="mcx-wl-punch">
                Falta pouco: o checkout abre em <strong>dezembro</strong>. Entre na lista agora
                e garanta um <strong>desconto que não vai existir para mais ninguém</strong>.
              </p>

              <ul className="mcx-wl-perks">
                <li className="mcx-wl-perk-hero">
                  <span className="mcx-wl-perk-ico">
                    <Percent size={15} />
                  </span>
                  <span>
                    <b>Desconto exclusivo no lançamento</b>
                    reservado a quem entrou na lista antes de abrirmos
                  </span>
                </li>
                <li>
                  <span className="mcx-wl-perk-ico">
                    <Bell size={15} />
                  </span>
                  <span>
                    <b>Avisado antes de todo mundo</b>
                    no WhatsApp e no e-mail, antes do anúncio público
                  </span>
                </li>
                <li>
                  <span className="mcx-wl-perk-ico">
                    <Rocket size={15} />
                  </span>
                  <span>
                    <b>Primeiro lote de acesso</b>
                    quando abrirmos, já com o plano {planName} guardado
                  </span>
                </li>
                <li>
                  <span className="mcx-wl-perk-ico">
                    <Lock size={15} />
                  </span>
                  <span>
                    <b>Sem cartão e sem compromisso</b>
                    o seu contato não vai para mais nada
                  </span>
                </li>
              </ul>

              <div className="mcx-wl-date">
                <Rocket size={20} />
                <div>
                  <div className="mcx-mono">Previsão de lançamento</div>
                  <strong>{LAUNCH_TARGET}</strong>
                </div>
              </div>

              <div className="mcx-wl-demo">
                <p className="mcx-wl-demo-lead">
                  <Sparkles size={14} />
                  Enquanto você espera, ele já faz isto — ao vivo, agora:
                </p>
                <DemoAoVivo />
              </div>
            </div>

            {/* --- coluna do formulário --- */}
            <div style={{ position: "relative", scrollMarginTop: 90 }} id="mcx-waitlist-form">
              <div className="mcx-auth-card" style={{ maxWidth: 520, marginLeft: "auto" }}>
                {done ? (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}
                  >
                    <span className="mcx-success-ring">
                      <CheckCircle2 size={30} />
                    </span>
                    <h2 className="mcx-h2" style={{ fontSize: "1.5rem" }}>
                      Está anotado, {fullName.trim().split(" ")[0]}.
                    </h2>
                    <p className="mcx-body">
                      Você entrou na lista de espera do plano{" "}
                      <strong style={{ color: "var(--text)" }}>{planName}</strong>. Assim que abrirmos
                      ao público, você é avisado no WhatsApp e no e-mail — antes do anúncio geral.
                    </p>
                    <div className="mcx-wl-promo">
                      <Percent size={16} />
                      <span>
                        <b>Seu desconto de lançamento está reservado.</b>
                        Ele vale só para quem entrou na lista antes da abertura, e vai no mesmo
                        aviso.
                      </span>
                    </div>
                    <div
                      className="mcx-alert mcx-alert-ok"
                      style={{ width: "100%" }}
                    >
                      <ShieldCheck size={16} />
                      <span>
                        Quem entrou agora fica no primeiro lote de acesso. Não vamos usar seu contato
                        para mais nada.
                      </span>
                    </div>
                    <Link href="/" className="mcx-btn mcx-btn-ghost" style={{ width: "100%" }}>
                      Voltar ao site
                    </Link>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 20 }}>
                      <span className="mcx-mono" style={{ color: "var(--brand)" }}>
                        Lista de espera
                      </span>
                      <h2 className="mcx-h2" style={{ fontSize: "1.55rem", marginTop: 8 }}>
                        Quero ser avisado no lançamento
                      </h2>
                      <p className="mcx-body" style={{ marginTop: 8, fontSize: ".9rem" }}>
                        Você escolheu o plano{" "}
                        <strong style={{ color: "var(--text)" }}>{planName}</strong>
                        {priceMonthly != null ? (
                          <>
                            {" "}
                            ({priceBRL(priceMonthly)}/mês, ciclo {cycleLabel})
                          </>
                        ) : null}
                        . Guardamos isso para avisar você primeiro.
                      </p>
                    </div>

                    <form className="mcx-form" onSubmit={(e) => void submit(e)} noValidate>
                      <div className="mcx-form-field">
                        <label className="mcx-label" htmlFor="wl-nome">
                          Nome completo *
                        </label>
                        <input
                          id="wl-nome"
                          className="mcx-input"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Como podemos te chamar"
                          autoComplete="name"
                          aria-invalid={Boolean(errors.fullName)}
                          required
                        />
                        {errors.fullName ? <span className="mcx-error">{errors.fullName}</span> : null}
                      </div>

                      <div className="mcx-form-field">
                        <label className="mcx-label" htmlFor="wl-whats">
                          WhatsApp com DDD *
                        </label>
                        <input
                          id="wl-whats"
                          className="mcx-input"
                          value={whatsapp}
                          onChange={(e) => setWhatsapp(formatWhatsapp(e.target.value))}
                          onBlur={() => {
                            const p = checkWhatsapp(whatsapp);
                            setErrors((prev) => ({ ...prev, whatsapp: p.ok ? "" : p.message }));
                          }}
                          placeholder="(62) 99999-9999"
                          inputMode="tel"
                          autoComplete="tel"
                          aria-invalid={Boolean(errors.whatsapp)}
                          required
                        />
                        {errors.whatsapp ? (
                          <span className="mcx-error">{errors.whatsapp}</span>
                        ) : (
                          <span className="mcx-hint">É por aqui que avisamos você primeiro.</span>
                        )}
                      </div>

                      <div className="mcx-form-field">
                        <label className="mcx-label" htmlFor="wl-email">
                          E-mail *
                        </label>
                        <input
                          id="wl-email"
                          className="mcx-input"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="voce@empresa.com.br"
                          autoComplete="email"
                          aria-invalid={Boolean(errors.email)}
                          required
                        />
                        {errors.email ? <span className="mcx-error">{errors.email}</span> : null}
                      </div>

                      <div className="mcx-form-field">
                        <label className="mcx-label" htmlFor="wl-seg">
                          Qual é o seu tipo de negócio? *
                        </label>
                        <select
                          id="wl-seg"
                          className="mcx-input"
                          value={segment}
                          onChange={(e) => setSegment(e.target.value)}
                          aria-invalid={Boolean(errors.segment)}
                          required
                        >
                          <option value="">Escolha uma opção</option>
                          {segments.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                          <option value="__outro">Outro — quero descrever</option>
                        </select>
                        {segment === "__outro" ? (
                          <input
                            className="mcx-input"
                            style={{ marginTop: 8 }}
                            value={otherSegment}
                            onChange={(e) => setOtherSegment(e.target.value)}
                            placeholder="Ex.: distribuidora de peças agrícolas"
                            aria-label="Descreva seu tipo de negócio"
                          />
                        ) : null}
                        {errors.segment ? <span className="mcx-error">{errors.segment}</span> : null}
                      </div>

                      {/* Armadilha invisível: bot preenche, gente não vê. */}
                      <input
                        type="text"
                        name="website"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                        aria-hidden="true"
                        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
                      />

                      {failure ? (
                        <div className="mcx-alert mcx-alert-error">
                          <span>{failure}</span>
                        </div>
                      ) : null}

                      <button
                        type="submit"
                        className="mcx-btn mcx-btn-primary mcx-btn-lg"
                        style={{ width: "100%" }}
                        disabled={sending}
                      >
                        {sending ? (
                          <>
                            <Loader2 size={17} className="mcx-spin" />
                            Salvando…
                          </>
                        ) : (
                          <>
                            Entrar na lista de espera
                            <ArrowRight size={17} />
                          </>
                        )}
                      </button>

                      <p className="mcx-hint" style={{ textAlign: "center" }}>
                        <Lock size={11} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
                        Seu contato fica só conosco. Sem spam, sem repasse.
                      </p>
                    </form>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        <section style={{ padding: "clamp(46px,6vw,86px) 0" }}>
          <div className="mcx-shell">
            <Reveal>
              <SectionLabel>Por que estamos a demorar</SectionLabel>
              <h2 className="mcx-h2">
                Porque o que vamos entregar
                <br />
                <span style={{ color: "var(--muted)" }}>não existe pronto no mercado.</span>
              </h2>
              <p className="mcx-lead" style={{ marginTop: 18 }}>
                Dá para juntar um chatbot genérico com uma planilha e chamar de CRM. Não é isso que
                estamos a construir — e é por isso que não abrimos antes de estar certo.
              </p>
            </Reveal>

            <div className="mcx-pipe" style={{ marginTop: 40, gridTemplateColumns: "1fr" }}>
              <div className="mcx-waitgrid">
                {BUILDING.map((item, i) => (
                  <Reveal key={item.title} delay={i * 0.06}>
                    <article className="mcx-card mcx-node" style={{ height: "100%" }}>
                      <div className="mcx-node-top">
                        <span className="mcx-node-idx">{String(i + 1).padStart(2, "0")}</span>
                        <span className="mcx-node-ico">
                          <Check size={16} />
                        </span>
                      </div>
                      <h3 className="mcx-h3">{item.title}</h3>
                      <p className="mcx-body">{item.body}</p>
                    </article>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section style={{ padding: "0 0 clamp(64px,8vw,104px)" }}>
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
                    <Clock size={12} style={{ color: "var(--brand-hi)" }} />
                    {LAUNCH_TARGET}
                  </span>
                  <h2 className="mcx-h2" style={{ maxWidth: 700, margin: "0 auto" }}>
                    Quem entra agora é avisado antes — e paga menos.
                  </h2>
                  <p className="mcx-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                    Sem compromisso e sem cartão. O seu lugar no primeiro lote e o desconto de
                    lançamento, guardados no seu nome.
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
                    <a href="#mcx-waitlist-form" className="mcx-btn mcx-btn-primary mcx-btn-lg">
                      <Sparkles size={16} />
                      Entrar na lista de espera
                    </a>
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

export { PLAN_LABEL };
