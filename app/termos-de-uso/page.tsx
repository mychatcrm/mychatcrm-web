import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LEGAL_CONTACT_EMAIL, PublicLegalPageShell } from "@/components/legal/PublicLegalPageShell";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Termos de Uso | MyChatCRM",
  description: "Termos de Uso do MyChatCRM — condições para utilização da plataforma de CRM e WhatsApp.",
  alternates: {
    canonical: "/termos-de-uso",
    languages: {
      "pt-BR": `${SITE_URL}/termos-de-uso`,
      en: `${SITE_URL}/en/terms-of-use`,
      es: `${SITE_URL}/es/terminos-de-uso`,
      "x-default": `${SITE_URL}/termos-de-uso`,
    },
  },
  openGraph: {
    title: "Termos de Uso | MyChatCRM",
    url: `${SITE_URL}/termos-de-uso`,
  },
};

const UPDATED = "20 de maio de 2026";

export default function TermosDeUsoPage() {
  return (
    <PublicLegalPageShell
      title="Termos de Uso"
      updated={UPDATED}
      footer={
        <p>
          Consulte também a{" "}
          <Link href="/politica-de-privacidade" className="text-primary hover:underline">
            Política de Privacidade
          </Link>
          .
        </p>
      }
    >
      <LegalSection title="1. Aceitação">
        <p>
          Ao acessar ou utilizar a plataforma <strong>MyChatCRM</strong>, disponível em{" "}
          <strong>mychatcrm.com.br</strong>, você declara ter lido e aceito estes Termos de Uso. Se não concordar,
          não utilize o serviço.
        </p>
      </LegalSection>

      <LegalSection title="2. Uso permitido">
        <p>A MyChatCRM oferece ferramentas de CRM, automação e atendimento, incluindo integração com:</p>
        <ul className="mt-2 list-disc space-y-2 pl-6">
          <li>
            <strong>Facebook Lead Ads</strong> — para receber e tratar leads de formulários de anúncios;
          </li>
          <li>
            <strong>WhatsApp</strong> — para comunicação com clientes finais, conforme conexões e políticas da
            Meta/WhatsApp.
          </li>
        </ul>
        <p className="mt-3">É permitido utilizar a plataforma para fins comerciais legítimos do seu negócio, desde que:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>você tenha base legal e consentimento quando exigido para contatar leads;</li>
          <li>respeite as políticas das integrações (Meta, WhatsApp, etc.);</li>
          <li>não utilize o serviço para spam, fraude, conteúdo ilícito ou violação de direitos de terceiros.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Responsabilidades">
        <p>
          O cliente é responsável pelos dados que insere, pelas mensagens enviadas aos seus leads, pelo cumprimento
          da LGPD e pelas configurações de agentes, funis e campanhas. A MyChatCRM envida esforços para manter o
          serviço disponível e seguro, mas não garante resultados comerciais específicos (vendas, conversões ou
          taxa de resposta).
        </p>
        <p className="mt-3">
          Dados de leads e conversas são armazenados de forma segura na infraestrutura contratada. A MyChatCRM{" "}
          <strong>não vende</strong> dados de clientes ou leads a terceiros.
        </p>
      </LegalSection>

      <LegalSection title="4. Cancelamento">
        <p>
          Planos são recorrentes conforme a oferta contratada. Você pode solicitar cancelamento pelos canais de
          suporte ou conforme instruções no painel. O cancelamento interrompe novas cobranças futuras; valores já
          pagos e períodos em curso seguem as regras da oferta vigente no momento da contratação.
        </p>
      </LegalSection>

      <LegalSection title="5. Limitação de responsabilidade">
        <p>
          Na extensão permitida pela lei, a MyChatCRM não se responsabiliza por lucros cessantes, perda de dados
          causada por uso indevido do cliente, indisponibilidade temporária de terceiros (WhatsApp, Meta, provedores
          de nuvem) ou eventos de força maior. Nossa responsabilidade total, quando aplicável, limita-se ao valor
          pago pelo cliente nos últimos 12 meses anteriores ao evento que originou a reclamação.
        </p>
      </LegalSection>

      <LegalSection title="6. Alterações">
        <p>
          Podemos atualizar estes Termos para refletir mudanças legais ou de produto. A data da última revisão
          consta no topo da página. O uso continuado após a publicação de alterações relevantes constitui aceitação.
        </p>
      </LegalSection>

      <LegalSection title="7. Contato">
        <p>
          Dúvidas sobre estes Termos:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </PublicLegalPageShell>
  );
}
