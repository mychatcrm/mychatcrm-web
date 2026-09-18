import { LandingForm } from "@/components/landing/public/LandingForm";
import type { LandingVersionContent } from "@/lib/landing/types";

/**
 * Renderizador das páginas publicadas.
 *
 * Servidor puro, com uma folha de estilos própria escopada em `.mcl`. Escopada
 * porque `app/globals.css` impõe regras a todas as páginas públicas do SaaS
 * (`.brand-marketing` força fonte, tamanhos de título e `box-shadow: none`), e
 * a página do cliente não pode herdar a identidade da MyChatCRM — ela é do
 * negócio dele.
 *
 * O texto vem do banco como texto e é interpolado pelo React, que escapa. Em
 * nenhum ponto há `dangerouslySetInnerHTML` com conteúdo de tenant.
 */

const RADIUS_MAP: Record<string, string> = {
  sharp: "0px",
  soft: "12px",
  round: "999px",
};

function styleSheet(content: LandingVersionContent): string {
  const { theme } = content;
  const radius = RADIUS_MAP[theme.radius] ?? RADIUS_MAP.soft;
  const cardRadius = theme.radius === "round" ? "24px" : radius;

  return `
.mcl{--mcl-accent:${theme.accent};--mcl-bg:${theme.background};--mcl-surface:${theme.surface};--mcl-text:${theme.text};--mcl-muted:${theme.muted};--mcl-radius:${radius};--mcl-card-radius:${cardRadius};
background:var(--mcl-bg);color:var(--mcl-text);min-height:100dvh;
font-family:var(--font-inter,system-ui),system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:clip;}
.mcl *,.mcl *::before,.mcl *::after{box-sizing:border-box;}
.mcl__wrap{width:100%;max-width:1040px;margin:0 auto;padding:0 20px;}
.mcl__section{padding:56px 0;}
.mcl__section--hero{padding:72px 0 40px;}
.mcl h1,.mcl h2,.mcl h3{margin:0 0 12px;line-height:1.15;font-weight:700;letter-spacing:-0.01em;}
.mcl h1{font-size:clamp(28px,5vw,46px);}
.mcl h2{font-size:clamp(22px,3.4vw,32px);}
.mcl h3{font-size:clamp(17px,2vw,20px);}
.mcl p{margin:0 0 12px;color:var(--mcl-muted);font-size:clamp(15px,1.8vw,18px);}
.mcl__eyebrow{display:inline-block;margin-bottom:14px;padding:6px 12px;border-radius:999px;
background:color-mix(in srgb,var(--mcl-accent) 18%,transparent);color:var(--mcl-accent);
font-size:13px;font-weight:600;letter-spacing:0.02em;}
.mcl__lede{color:var(--mcl-text);opacity:0.85;max-width:62ch;}
.mcl__grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));}
.mcl__card{background:var(--mcl-surface);border:1px solid color-mix(in srgb,var(--mcl-text) 12%,transparent);
border-radius:var(--mcl-card-radius);padding:20px;min-width:0;}
.mcl__card p:last-child{margin-bottom:0;}
.mcl__quote{font-style:normal;margin:0;}
.mcl__quote p{color:var(--mcl-text);}
.mcl__author{display:block;margin-top:8px;color:var(--mcl-muted);font-size:14px;}
.mcl__faq{border-bottom:1px solid color-mix(in srgb,var(--mcl-text) 12%,transparent);padding:16px 0;}
.mcl__faq:last-child{border-bottom:0;}
.mcl__cta-band{background:var(--mcl-surface);border-radius:var(--mcl-card-radius);padding:32px;text-align:center;}
.mcl__footer{padding:32px 0;border-top:1px solid color-mix(in srgb,var(--mcl-text) 12%,transparent);
color:var(--mcl-muted);font-size:14px;}
.mcl__footer a{color:var(--mcl-muted);}
.mcl__anchor{display:inline-block;margin-top:8px;padding:14px 26px;border-radius:var(--mcl-radius);
background:var(--mcl-accent);color:#fff;text-decoration:none;font-weight:600;font-size:16px;}
.mcl-form{display:grid;gap:14px;background:var(--mcl-surface);padding:22px;
border-radius:var(--mcl-card-radius);border:1px solid color-mix(in srgb,var(--mcl-text) 12%,transparent);}
.mcl-field{display:grid;gap:6px;min-width:0;}
.mcl-field__label{font-size:14px;font-weight:600;color:var(--mcl-text);}
.mcl-field__error{color:#ff6b5e;font-size:13px;}
.mcl-input{width:100%;padding:13px 14px;border-radius:var(--mcl-radius);
border:1px solid color-mix(in srgb,var(--mcl-text) 22%,transparent);
background:color-mix(in srgb,var(--mcl-bg) 70%,transparent);color:var(--mcl-text);
font-size:16px;font-family:inherit;}
.mcl-input:focus{outline:2px solid var(--mcl-accent);outline-offset:1px;}
.mcl-consent{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--mcl-muted);}
.mcl-consent input{margin-top:3px;width:18px;height:18px;flex:0 0 auto;accent-color:var(--mcl-accent);}
.mcl-submit{padding:15px 20px;border:0;color:#fff;font-size:17px;font-weight:700;cursor:pointer;font-family:inherit;}
.mcl-submit:disabled{opacity:0.55;cursor:not-allowed;}
.mcl-form__success{color:var(--mcl-text);font-size:18px;margin:0;}
.mcl-form__error{color:#ff6b5e;font-size:14px;margin:0;}
.mcl-form--done{text-align:center;}
.mcl-hp{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.mcl__hero-layout{display:grid;gap:28px;align-items:start;grid-template-columns:1fr;}
@media (min-width:900px){.mcl__hero-layout{grid-template-columns:1.1fr 0.9fr;gap:40px;}
.mcl__section--hero{padding:84px 0 48px;}}
.mcl__hero-layout > *{min-width:0;}
`.trim();
}

export function LandingRenderer({
  content,
  privacyHref,
}: {
  content: LandingVersionContent;
  privacyHref: string;
}) {
  const formBlock = content.blocks.find((block) => block.kind === "form");
  const radius = RADIUS_MAP[content.theme.radius] ?? RADIUS_MAP.soft;

  const formElement =
    formBlock && formBlock.kind === "form" ? (
      <div id="formulario">
        <h2>{formBlock.title}</h2>
        {formBlock.description ? <p>{formBlock.description}</p> : null}
        <LandingForm
          block={formBlock}
          fields={content.formFields}
          accent={content.theme.accent}
          radius={radius}
        />
      </div>
    ) : null;

  /**
   * O formulário sobe para dentro do herói, mas só pode existir UMA vez.
   *
   * Decidir isso com uma variável mutável durante o `map` dependia da ordem dos
   * blocos: com o formulário antes do herói, ele renderizava nos dois sítios —
   * dois formulários e dois elementos com o mesmo `id`, que quebra a âncora do
   * botão e a acessibilidade. A decisão é tomada antes, sobre a lista inteira.
   */
  const hasHero = content.blocks.some((block) => block.kind === "hero");

  return (
    <div className="mcl">
      <style dangerouslySetInnerHTML={{ __html: styleSheet(content) }} />

      {content.blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;

        switch (block.kind) {
          case "hero": {
            return (
              <section key={key} className="mcl__section mcl__section--hero">
                <div className="mcl__wrap mcl__hero-layout">
                  <div>
                    {block.eyebrow ? <span className="mcl__eyebrow">{block.eyebrow}</span> : null}
                    <h1>{block.headline}</h1>
                    {block.subheadline ? <p className="mcl__lede">{block.subheadline}</p> : null}
                    <a className="mcl__anchor" href="#formulario">
                      {block.ctaLabel}
                    </a>
                  </div>
                  {/* O formulário sobe para junto do herói: a primeira dobra é
                      onde a conversão acontece em tráfego pago. */}
                  {formElement}
                </div>
              </section>
            );
          }

          case "benefits":
            return (
              <section key={key} className="mcl__section">
                <div className="mcl__wrap">
                  <h2>{block.title}</h2>
                  <div className="mcl__grid">
                    {block.items.map((item, itemIndex) => (
                      <div key={`${item.title}-${itemIndex}`} className="mcl__card">
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            );

          case "proof":
            return (
              <section key={key} className="mcl__section">
                <div className="mcl__wrap">
                  <h2>{block.title}</h2>
                  <div className="mcl__grid">
                    {block.items.map((item, itemIndex) => (
                      <blockquote key={`${item.author}-${itemIndex}`} className="mcl__card mcl__quote">
                        <p>{item.quote}</p>
                        <cite className="mcl__author">{item.author}</cite>
                      </blockquote>
                    ))}
                  </div>
                </div>
              </section>
            );

          case "faq":
            return (
              <section key={key} className="mcl__section">
                <div className="mcl__wrap">
                  <h2>{block.title}</h2>
                  {block.items.map((item, itemIndex) => (
                    <div key={`${item.question}-${itemIndex}`} className="mcl__faq">
                      <h3>{item.question}</h3>
                      <p>{item.answer}</p>
                    </div>
                  ))}
                </div>
              </section>
            );

          case "form":
            // Com herói, o formulário já está lá dentro. Sem herói, entra aqui.
            if (hasHero) return null;
            return (
              <section key={key} className="mcl__section">
                <div className="mcl__wrap">{formElement}</div>
              </section>
            );

          case "cta":
            return (
              <section key={key} className="mcl__section">
                <div className="mcl__wrap">
                  <div className="mcl__cta-band">
                    <h2>{block.headline}</h2>
                    {block.description ? <p>{block.description}</p> : null}
                    <a className="mcl__anchor" href="#formulario">
                      {block.ctaLabel}
                    </a>
                  </div>
                </div>
              </section>
            );

          case "footer":
            return (
              <footer key={key} className="mcl__footer">
                <div className="mcl__wrap">
                  {block.businessName ? <p>{block.businessName}</p> : null}
                  {block.legalLine ? <p>{block.legalLine}</p> : null}
                  <p>
                    <a href={privacyHref}>Política de privacidade</a>
                  </p>
                </div>
              </footer>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
