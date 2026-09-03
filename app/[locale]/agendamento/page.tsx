import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/constants";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { PASSOS, PERGUNTAS, SITUACOES } from "./conteudo";
import { AgendamentoView } from "./AgendamentoView";

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: "Agendamento automático pelo WhatsApp | MyChatCRM",
  description:
    "Um agente que marca, remarca, cancela e lembra sozinho no WhatsApp — conferindo a sua agenda real antes de confirmar. Veja as 10 situações e a resposta dele em cada uma.",
  keywords: [
    "agendamento automático whatsapp",
    "agendar pelo whatsapp",
    "marcar horário automático",
    "chatbot que agenda",
    "agenda automática whatsapp",
    "confirmação de agendamento automática",
    "lembrete automático whatsapp",
    "crm com agenda integrada",
  ],
  alternates: {
    canonical: "/agendamento",
    languages: {
      "pt-BR": `${SITE_URL}/agendamento`,
      "x-default": `${SITE_URL}/agendamento`,
    },
  },
  openGraph: {
    title: "Agendamento automático pelo WhatsApp | MyChatCRM",
    description:
      "As 10 situações que um cliente cria ao marcar horário — e o que o agente responde em cada uma, com a agenda conferida antes de confirmar.",
    url: `${SITE_URL}/agendamento`,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "MyChatCRM — agendamento automático" }],
  },
};

/** Como ligar: três passos, que é o que o Google entende por "como fazer X". */
function buildHowToSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Como ligar o agendamento automático no WhatsApp",
    description:
      "Configurar um agente de IA para marcar, remarcar, cancelar e lembrar agendamentos pelo WhatsApp, conferindo a agenda real antes de confirmar.",
    inLanguage: "pt-BR",
    totalTime: "PT10M",
    step: PASSOS.map((p, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: p.titulo,
      text: p.texto,
      url: `${SITE_URL}/agendamento`,
    })),
  };
}

/**
 * As perguntas como FAQPage, e as dez situações como perguntas também.
 *
 * É a forma mais directa de entregar a página inteira em texto estruturado — o
 * Google usa para os resultados expandidos e os motores generativos leem daqui
 * a resposta concreta do agente em cada caso, que é o que esta página tem de
 * único.
 */
function buildFaqSchema() {
  const dasSituacoes = SITUACOES.map((s) => ({
    "@type": "Question",
    name: `Agendamento pelo WhatsApp: ${s.tag.toLowerCase()}. O que o agente responde?`,
    acceptedAnswer: {
      "@type": "Answer",
      text: `${s.resposta} (${s.fez.join("; ")}.)`,
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "pt-BR",
    mainEntity: [
      ...PERGUNTAS.map((p) => ({
        "@type": "Question",
        name: p.q,
        acceptedAnswer: { "@type": "Answer", text: p.a },
      })),
      ...dasSituacoes,
    ],
  };
}

export default async function AgendamentoPage({ params }: Props) {
  await params;

  const structuredData = [
    buildBreadcrumbSchema([
      { name: "Início", path: "/" },
      { name: "Agendamento automático", path: "/agendamento" },
    ]),
    buildHowToSchema(),
    buildFaqSchema(),
  ];

  return (
    <>
      {structuredData.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <AgendamentoView />
    </>
  );
}
