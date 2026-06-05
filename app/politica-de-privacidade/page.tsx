import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, LEGAL_CONTACT_EMAIL, PublicLegalPageShell } from "@/components/legal/PublicLegalPageShell";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Política de Privacidade | MyChatCRM",
  description:
    "Política de Privacidade do MyChatCRM — como tratamos dados de leads, WhatsApp e uso da plataforma.",
  alternates: {
    canonical: "/politica-de-privacidade",
    languages: {
      "pt-BR": `${SITE_URL}/politica-de-privacidade`,
      en: `${SITE_URL}/en/privacy-policy`,
      es: `${SITE_URL}/es/politica-de-privacidad`,
      "x-default": `${SITE_URL}/politica-de-privacidade`,
    },
  },
  openGraph: {
    title: "Política de Privacidade | MyChatCRM",
    url: `${SITE_URL}/politica-de-privacidade`,
  },
};

const UPDATED = "20 de maio de 2026";

export default function PoliticaDePrivacidadePage() {
  return (
    <PublicLegalPageShell
      title="Política de Privacidade"
      updated={UPDATED}
      footer={
        <p>
          Esta política complementa os{" "}
          <Link href="/termos-de-uso" className="text-primary hover:underline">
            Termos de Uso
          </Link>
          . Em caso de conflito com a legislação brasileira, prevalece a lei aplicável.
        </p>
      }
    >
      <LegalSection title="1. Quem somos">
        <p>
          A <strong>MyChatCRM</strong> é a plataforma de automação e CRM conversacional disponível em{" "}
          <strong>mychatcrm.com.br</strong>. Esta Política explica como tratamos dados pessoais em conformidade com a{" "}
          <strong>Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>.
        </p>
      </LegalSection>

      <LegalSection title="2. Dados que coletamos">
        <ul className="mt-2 list-disc space-y-2 pl-6">
          <li>
            <strong>Dados de cadastro:</strong> nome, e-mail, telefone, empresa e informações de faturamento
            fornecidas ao contratar o serviço.
          </li>
          <li>
            <strong>Leads e formulários:</strong> dados enviados por campanhas de{" "}
            <strong>Facebook Lead Ads</strong> e outras origens conectadas pelo cliente (nome, telefone, e-mail,
            respostas de formulário e metadados da campanha).
          </li>
          <li>
            <strong>WhatsApp e conversas:</strong> mensagens, números de telefone, mídias e metadados trocados
            nas conversas atendidas pela plataforma, conforme integrações autorizadas pelo cliente.
          </li>
          <li>
            <strong>Dados de uso:</strong> logs de acesso, IP, dispositivo, navegador e ações na plataforma para
            segurança, suporte e melhoria do produto.
          </li>
          <li>
            <strong>Cookies e tecnologias similares:</strong> identificadores de sessão e preferências essenciais ao
            funcionamento do site e do painel.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Finalidade do tratamento">
        <ul className="mt-2 list-disc space-y-2 pl-6">
          <li>Prestar, operar e melhorar os serviços da MyChatCRM;</li>
          <li>Receber, organizar e responder leads captados via Facebook Lead Ads e WhatsApp;</li>
          <li>Automatizar atendimentos, funis de CRM e follow-ups configurados pelo cliente;</li>
          <li>Processar pagamentos, emitir cobranças e cumprir obrigações legais;</li>
          <li>Garantir segurança, prevenção a fraudes e suporte técnico;</li>
          <li>Enviar comunicações transacionais sobre a conta e o serviço.</li>
        </ul>
        <p className="mt-3">
          Dados inseridos pelo cliente sobre seus próprios leads são de responsabilidade do cliente enquanto
          controlador; a MyChatCRM atua como operadora na medida do contrato de uso.
        </p>
      </LegalSection>

      <LegalSection title="4. Armazenamento e segurança">
        <p>
          Os dados são armazenados em infraestrutura de nuvem com controles de acesso, criptografia em trânsito
          (TLS) e práticas de segurança alinhadas ao mercado. Senhas são tratadas com mecanismos de hash seguro.
          Mantemos os dados pelo tempo necessário à prestação do serviço e ao cumprimento de obrigações legais.
        </p>
        <p className="mt-3">
          <strong>Não vendemos</strong> dados pessoais a terceiros para fins comerciais. Compartilhamos informações
          apenas com provedores essenciais (hospedagem, banco de dados, pagamentos, APIs de mensageria e integrações
          autorizadas pelo cliente) e com autoridades quando exigido por lei.
        </p>
      </LegalSection>

      <LegalSection title="5. Direitos do titular (LGPD)">
        <p>Você pode solicitar, conforme a LGPD:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>confirmação e acesso aos dados tratados;</li>
          <li>correção de dados incompletos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários;</li>
          <li>portabilidade, quando aplicável;</li>
          <li>revogação de consentimento e informações sobre compartilhamentos;</li>
          <li>reclamação à Autoridade Nacional de Proteção de Dados (ANPD).</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Cookies">
        <p>
          Utilizamos cookies e armazenamento local estritamente necessários para autenticação, segurança e
          funcionamento do painel. Cookies analíticos ou de marketing, quando utilizados, dependerão de
          consentimento ou configuração do navegador. Você pode gerenciar cookies nas preferências do seu
          dispositivo.
        </p>
      </LegalSection>

      <LegalSection title="7. Contato">
        <p>
          Para dúvidas, solicitações de privacidade ou exercício de direitos, escreva para{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-primary hover:underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          . Responderemos em prazo razoável, em geral até 15 dias úteis.
        </p>
      </LegalSection>
    </PublicLegalPageShell>
  );
}
