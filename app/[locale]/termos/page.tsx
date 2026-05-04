import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

type Props = { params: Promise<{ locale: string }> };

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: "Termos de Uso | MyChatCRM",
  description: "Termos de Uso do MyChatCRM — condições para utilização da plataforma.",
  alternates: {
    canonical: "/termos",
    languages: {
      "pt-BR": `${SITE_URL}/termos`,
      "x-default": `${SITE_URL}/termos`,
    },
  },
};

export default async function TermosPage(_props: Props) {
  const updated = "03 de maio de 2026";

  return (
    <div className="min-h-screen bg-surface-base">
      <div className="mx-auto max-w-3xl px-4 py-16 text-content">
        <Link href="/" className="text-sm text-primary hover:underline">
          ← Voltar ao início
        </Link>

        <h1 className="mt-8 font-display text-3xl font-bold">Termos de Uso</h1>
        <p className="mt-2 text-sm text-content-muted">Última atualização: {updated}</p>

        <div className="prose prose-invert mt-10 max-w-none space-y-8 text-sm leading-relaxed text-content-secondary">

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">1. Aceitação</h2>
            <p>
              Ao acessar ou utilizar a plataforma MyChatCRM, disponibilizada em{" "}
              <strong>mychatcrm.com.br</strong> (&ldquo;Plataforma&rdquo;), o Usuário concorda integralmente
              com estes Termos de Uso. Se não concordar, não utilize a Plataforma.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">2. Descrição do Serviço</h2>
            <p>
              O MyChatCRM é uma plataforma de CRM e atendimento via WhatsApp com recursos de
              inteligência artificial, gestão de leads, funis de vendas, agendamento e automações.
              O serviço é prestado no modelo SaaS (Software como Serviço), com planos de
              assinatura mensal ou anual.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">3. Cadastro e Conta</h2>
            <p>
              Para utilizar a Plataforma, o Usuário deve se cadastrar com informações verdadeiras,
              completas e atualizadas. O Usuário é responsável por manter a confidencialidade de
              suas credenciais de acesso e por todas as atividades realizadas em sua conta.
              Em caso de uso não autorizado, o Usuário deve notificar imediatamente o suporte
              da MyChatCRM.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">4. Planos e Pagamento</h2>
            <p>
              Os planos disponíveis, preços e condições estão descritos na página{" "}
              <Link href="/planos" className="text-primary hover:underline">
                /planos
              </Link>
              . Os pagamentos são processados pelo Stripe, plataforma de pagamentos terceirizada,
              e sujeitos aos seus termos próprios. A MyChatCRM não armazena dados de cartão de
              crédito. As assinaturas são renovadas automaticamente no ciclo contratado (mensal
              ou anual) até o cancelamento pelo Usuário.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">5. Cancelamento e Reembolso</h2>
            <p>
              O Usuário pode cancelar a assinatura a qualquer momento pelo painel da Plataforma
              ou pelo suporte. O cancelamento encerra a renovação automática; o acesso permanece
              ativo até o fim do período já pago. Reembolsos são concedidos nos primeiros 7 dias
              corridos após a contratação, mediante solicitação ao suporte, conforme o{" "}
              <a
                href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Código de Defesa do Consumidor (art. 49)
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">6. Uso Aceitável</h2>
            <p>É vedado ao Usuário:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Utilizar a Plataforma para fins ilegais, fraudulentos ou que violem direitos de terceiros;</li>
              <li>Enviar mensagens em massa (spam) sem consentimento dos destinatários;</li>
              <li>Compartilhar credenciais de acesso com terceiros não autorizados;</li>
              <li>Realizar engenharia reversa, descompilar ou tentar obter o código-fonte da Plataforma;</li>
              <li>Sobrecarregar deliberadamente a infraestrutura da Plataforma.</li>
            </ul>
            <p className="mt-3">
              O descumprimento destas regras pode resultar em suspensão ou cancelamento imediato
              da conta, sem direito a reembolso.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">7. Propriedade Intelectual</h2>
            <p>
              Todo o conteúdo da Plataforma — incluindo código, design, marcas e textos — é de
              propriedade exclusiva da MyChatCRM ou de seus licenciantes. O Usuário recebe uma
              licença limitada, não exclusiva e intransferível para uso da Plataforma durante a
              vigência da assinatura.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">8. Dados do Usuário</h2>
            <p>
              Os dados inseridos na Plataforma pelo Usuário pertencem ao próprio Usuário. A
              MyChatCRM trata esses dados conforme a{" "}
              <Link href="/privacidade" className="text-primary hover:underline">
                Política de Privacidade
              </Link>{" "}
              e a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">9. Disponibilidade e SLA</h2>
            <p>
              A MyChatCRM envidar esforços razoáveis para manter a Plataforma disponível 24 horas
              por dia, 7 dias por semana. No entanto, interrupções para manutenção, atualizações
              ou por causas externas (força maior, falhas de infraestrutura de terceiros) podem
              ocorrer e não geram direito a ressarcimento, salvo nas hipóteses previstas em lei.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">10. Limitação de Responsabilidade</h2>
            <p>
              A MyChatCRM não se responsabiliza por lucros cessantes, danos indiretos ou perdas
              de dados resultantes do uso ou impossibilidade de uso da Plataforma, exceto nos
              casos em que a legislação aplicável vede tal exclusão.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">11. Alterações nos Termos</h2>
            <p>
              A MyChatCRM pode atualizar estes Termos a qualquer momento. Alterações relevantes
              serão comunicadas por e-mail ou aviso na Plataforma com antecedência mínima de 15
              dias. O uso continuado após a vigência das alterações constitui aceitação dos novos
              Termos.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">12. Foro e Lei Aplicável</h2>
            <p>
              Estes Termos são regidos pelas leis da República Federativa do Brasil. As partes
              elegem o foro da comarca de São Paulo/SP para dirimir quaisquer controvérsias
              decorrentes deste instrumento, renunciando a qualquer outro, por mais privilegiado
              que seja.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-content">13. Contato</h2>
            <p>
              Dúvidas sobre estes Termos: entre em contato pelo suporte disponível na Plataforma
              ou acesse{" "}
              <strong>mychatcrm.com.br</strong>.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
