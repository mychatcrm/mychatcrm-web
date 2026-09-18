/**
 * Renderizador público das páginas de captura.
 *
 * Só é alcançado por reescrita do middleware, que resolve o host. Um pedido
 * direto a `/sites/...` no domínio do SaaS é bloqueado lá — se não fosse,
 * qualquer pessoa leria a página de qualquer cliente por um caminho interno.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingRenderer } from "@/components/landing/public/LandingRenderer";
import { landingHostConfig } from "@/lib/landing/config";
import { extractPlatformSlug } from "@/lib/landing/host-routing";
import { normalizeLandingHost } from "@/lib/landing/domain";
import { resolvePublishedLandingByHost } from "@/lib/server/landing-pages-db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageParams = { params: { host: string; path?: string[] } };

/**
 * Resolve a página e **nunca deixa uma exceção subir**.
 *
 * Isto é servido no domínio do cliente. Uma variável de ambiente em falta, o
 * banco fora do ar ou uma migração por aplicar não podem virar página de erro
 * com rasto de pilha no endereço comercial dele — vira "não encontrada", que é
 * o que um visitante deve ver.
 */
async function loadPage(hostParam: string) {
  try {
    const host = normalizeLandingHost(decodeURIComponent(hostParam ?? ""));
    if (!host) return null;
    const config = landingHostConfig();
    return await resolvePublishedLandingByHost({
      host,
      platformSlug: extractPlatformSlug(host, config.pagesDomain),
    });
  } catch (error) {
    console.error("[sites] resolução da página falhou", error);
    return null;
  }
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const published = await loadPage(params.host);
  if (!published) return { title: "Página não encontrada", robots: { index: false, follow: false } };

  const { seo } = published.version.content;
  return {
    title: seo.title,
    description: seo.description,
    /**
     * Rascunho e páginas marcadas como não indexáveis ficam fora do Google.
     * Uma landing de campanha paga normalmente NÃO deve ser indexada: ela
     * competiria com o site do próprio cliente pela mesma palavra.
     */
    robots: seo.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: seo.title, description: seo.description, type: "website" },
    // O ícone da MyChatCRM não pode aparecer na aba de uma página de cliente.
    icons: { icon: [] },
  };
}

export default async function LandingSitePage({ params }: PageParams) {
  const published = await loadPage(params.host);
  if (!published) notFound();

  const segments = params.path ?? [];
  const first = segments[0]?.toLowerCase() ?? "";

  if (first && first !== "privacidade") notFound();

  if (first === "privacidade") {
    return (
      <LandingPrivacy
        content={published.version.content}
        host={published.host}
      />
    );
  }

  return (
    <LandingRenderer content={published.version.content} privacyHref="/privacidade" />
  );
}

/**
 * Política de privacidade da página.
 *
 * Não é acessório: o Google Ads exige uma na landing para aprovar o anúncio, e
 * a LGPD exige para captar o dado. Gerar automaticamente remove o motivo mais
 * comum de reprovação de anúncio em conta nova.
 */
function LandingPrivacy({
  content,
  host,
}: {
  content: import("@/lib/landing/types").LandingVersionContent;
  host: string;
}) {
  const footer = content.blocks.find((block) => block.kind === "footer");
  const businessName =
    footer && footer.kind === "footer" && footer.businessName ? footer.businessName : host;

  return (
    <div className="mcl">
      <style
        dangerouslySetInnerHTML={{
          __html: `.mcl{background:${content.theme.background};color:${content.theme.text};min-height:100dvh;font-family:var(--font-inter,system-ui),system-ui,-apple-system,sans-serif;line-height:1.6;}
.mcl__wrap{max-width:760px;margin:0 auto;padding:56px 20px;}
.mcl h1{font-size:28px;margin:0 0 20px;}
.mcl h2{font-size:19px;margin:28px 0 8px;}
.mcl p,.mcl li{color:${content.theme.muted};font-size:15px;margin:0 0 10px;}
.mcl a{color:${content.theme.accent};}`,
        }}
      />
      <div className="mcl__wrap">
        <h1>Política de privacidade</h1>
        <p>
          Esta página é operada por {businessName}. Aqui explicamos que dados recolhemos no
          formulário, para que servem e como pedir a sua remoção.
        </p>

        <h2>Que dados recolhemos</h2>
        <p>
          Apenas o que você escreve no formulário — tipicamente nome, WhatsApp e e-mail — e
          informação técnica do acesso, como a origem do clique e o endereço de rede de forma
          codificada.
        </p>

        <h2>Para que usamos</h2>
        <p>
          Para entrar em contacto sobre a solicitação que você enviou e para medir quais campanhas
          trazem pedidos reais. Não vendemos os seus dados e não os partilhamos com terceiros para
          publicidade.
        </p>

        <h2>Por quanto tempo guardamos</h2>
        <p>
          Enquanto durar o atendimento e o prazo legal aplicável. Depois disso, os dados são
          eliminados ou anonimizados.
        </p>

        <h2>Os seus direitos</h2>
        <p>
          Você pode pedir a confirmação, a correção, a portabilidade ou a eliminação dos seus dados,
          e retirar o consentimento a qualquer momento. Basta responder à conversa iniciada no
          WhatsApp ou usar o mesmo contacto pelo qual falámos consigo.
        </p>

        <h2>Base legal</h2>
        <p>
          O tratamento tem por base o seu consentimento, recolhido no momento do envio do
          formulário, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018).
        </p>

        <p>
          <a href="/">Voltar à página</a>
        </p>
      </div>
    </div>
  );
}
