import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/constants";
import { buildBreadcrumbSchema } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { ACTS } from "./acts";
import { AgendamentoView } from "./AgendamentoView";

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: "Agendamento automático pelo WhatsApp | MyChatCRM",
  description:
    "Veja passo a passo como o agente marca, remarca, cancela e lembra sozinho pelo WhatsApp — conferindo a sua agenda real e movendo o card no CRM a cada confirmação.",
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
      "Do primeiro “oi” ao cancelamento: o ciclo inteiro de um agendamento feito pelo agente, sem ninguém de plantão.",
    url: `${SITE_URL}/agendamento`,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "MyChatCRM — agendamento automático" }],
  },
};

/**
 * Os dez atos viram um HowTo: é a forma que o Google entende para "como
 * funciona X", e alimenta os motores generativos com o ciclo inteiro em texto
 * estruturado, não só na animação.
 */
function buildHowToSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Como funciona o agendamento automático pelo WhatsApp",
    description:
      "O ciclo completo de um agendamento feito por um agente de IA no WhatsApp: pedido, verificação de disponibilidade, confirmação, lembrete, remarcação e cancelamento.",
    inLanguage: "pt-BR",
    totalTime: "PT3M",
    step: ACTS.map((act, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: act.title,
      text: act.body,
      url: `${SITE_URL}/agendamento#ato-${act.id}`,
    })),
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
