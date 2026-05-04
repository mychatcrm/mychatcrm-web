import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: "Política de Privacidade | MyChatCRM",
  description: "Política de Privacidade do MyChatCRM — como tratamos seus dados pessoais (LGPD).",
  alternates: {
    canonical: "/privacidade",
    languages: {
      "pt-BR": `${SITE_URL}/privacidade`,
      "x-default": `${SITE_URL}/privacidade`,
    },
  },
};

export default async function PrivacidadePage(_props: Props) {
  const updated = "03 de maio de 2026";

  return (
    <div className="min-h-screen bg-surface-base">
      <div className="mx-auto max-w-3xl px-4 py-16 text-content">
        <Link href="/" className="text-sm text-primary hover:underline">
          ← Voltar ao início
        </Link>

        <h1 className="mt-8 font-display text-3xl font-bold">Política de Privacidade</h1>
        <p className="mt-2 text-sm text-content-muted">Última atualização: {updated}</p>

        <div className="prose prose-invert mt-10 max-w-none space-y-8 text-sm leading-relaxed text-content-secondary">

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">1. Quem somos</h2>
            <p>
              A <strong>MyChatCRM</strong> é responsável pelo tratamento dos dados pessoais
              coletados por meio da Plataforma disponível em <strong>mychatcrm.com.br</strong>.
              Esta Política descreve como coletamos, usamos, armazenamos e protegemos suas
              informações, em conformidade com a{" "}
              <strong>Lei Geral de Proteção de Dados (LGPD &mdash; Lei nº 13.709/2018)</strong>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">2. Dados que coletamos</h2>
            <ul className="mt-2 list-disc space-y-2 pl-6">
              <li>
                <strong>Dados de cadastro:</strong> nome, e-mail, telefone, empresa e CPF/CNPJ
                fornecidos no momento da contratação.
              </li>
              <li>
                <strong>Dados de pagamento:</strong> processados diretamente pelo Stripe. A
                MyChatCRM <strong>não armazena</strong> dados de cartão de crédito.
              </li>
              <li>
                <strong>Dados de uso:</strong> registros de acesso, endereço IP, dispositivo,
                navegador e páginas visitadas, coletados automaticamente para segurança e
                melhoria do serviço.
              </li>
              <li>
                <strong>Dados inseridos na Plataforma:</strong> leads, conversas, funis e demais
                informações de clientes que o Usuário inserir ao operar a Plataforma. Esses dados
                são de titularidade do Usuário; a MyChatCRM atua como operadora.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">3. Finalidade do tratamento</h2>
            <ul className="mt-2 list-disc space-y-2 pl-6">
              <li>Prestação e melhoria dos serviços contratados;</li>
              <li>Processamento de pagamentos e emissão de notas fiscais;</li>
              <li>Comunicações transacionais (confirmação de conta, cobranças, suporte);</li>
              <li>Cumprimento de obrigações legais e regulatórias;</li>
              <li>Prevenção de fraudes e segurança da Plataforma;</li>
              <li>Comunicações de marketing, desde que o Usuário tenha consentido.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">4. Base legal</h2>
            <p>
              O tratamento dos dados é fundamentado nas seguintes bases legais (art. 7º da LGPD):
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Execução de contrato — para a prestação dos serviços;</li>
              <li>Cumprimento de obrigação legal — para obrigações fiscais e regulatórias;</li>
              <li>Legítimo interesse — para segurança, prevenção de fraudes e melhorias;</li>
              <li>Consentimento — para comunicações de marketing.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">5. Compartilhamento de dados</h2>
            <p>
              A MyChatCRM pode compartilhar dados com:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                <strong>Stripe</strong> — processamento de pagamentos;
              </li>
              <li>
                <strong>Supabase</strong> — banco de dados em nuvem (infraestrutura);
              </li>
              <li>
                <strong>Vercel</strong> — hospedagem e entrega do serviço;
              </li>
              <li>
                Autoridades públicas, quando exigido por lei.
              </li>
            </ul>
            <p className="mt-3">
              Não vendemos dados pessoais a terceiros para fins comerciais.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">6. Retenção dos dados</h2>
            <p>
              Os dados são armazenados pelo tempo necessário à prestação dos serviços e ao
              cumprimento de obrigações legais. Após o encerramento da conta, os dados podem
              ser mantidos por até 5 anos para fins fiscais e de prevenção de fraudes, conforme
              a legislação brasileira.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">7. Segurança</h2>
            <p>
              Adotamos medidas técnicas e organizacionais adequadas para proteger seus dados,
              incluindo criptografia em trânsito (TLS), controle de acesso por função e
              armazenamento de senhas com hash seguro. Nenhum sistema é 100% inviolável;
              em caso de incidente, notificaremos os titulares e a ANPD conforme a LGPD.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">8. Seus direitos (LGPD)</h2>
            <p>Você tem direito a:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Confirmar a existência do tratamento e acessar seus dados;</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
              <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários;</li>
              <li>Solicitar a portabilidade dos seus dados;</li>
              <li>Revogar o consentimento a qualquer momento;</li>
              <li>Reclamar perante a ANPD (Autoridade Nacional de Proteção de Dados).</li>
            </ul>
            <p className="mt-3">
              Para exercer esses direitos, entre em contato pelo suporte da Plataforma.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">9. Cookies</h2>
            <p>
              Utilizamos cookies essenciais para autenticação e funcionamento da Plataforma.
              Cookies analíticos e de marketing são utilizados apenas com o seu consentimento.
              Você pode gerenciar os cookies nas configurações do seu navegador.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">10. Alterações nesta Política</h2>
            <p>
              Podemos atualizar esta Política periodicamente. Alterações relevantes serão
              comunicadas por e-mail ou aviso na Plataforma. A data de última atualização
              é indicada no topo deste documento.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">11. Contato e DPO</h2>
            <p>
              Para dúvidas, solicitações ou exercício dos seus direitos, entre em contato pelo
              suporte da Plataforma em{" "}
              <strong>mychatcrm.com.br</strong>. Também nos comprometemos a responder
              solicitações em até 15 dias úteis, conforme a LGPD.
            </p>
          </section>

          <div className="mt-10 border-t border-line pt-6 text-xs text-content-faint">
            <p>
              Esta Política complementa os{" "}
              <Link href="/termos" className="text-primary hover:underline">
                Termos de Uso
              </Link>
              . Em caso de conflito, prevalece o disposto na legislação brasileira vigente.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
