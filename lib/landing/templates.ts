/**
 * Modelos de partida.
 *
 * São ESTRUTURA, não conteúdo de nicho: a ordem dos blocos, o que cada um
 * responde e quantos campos o formulário pede. O texto é marcador e sai assim
 * que a geração roda com os dados reais do tenant.
 *
 * Três modelos, de propósito. Não é limitação de esforço — é a diferença entre
 * um produto que decide por quem compra tráfego e um editor visual, que é onde
 * as plataformas de site já ganharam e não vale a pena disputar.
 */

import { defaultLandingFormFields } from "@/lib/landing/form-schema";
import { DEFAULT_LANDING_THEME } from "@/lib/landing/blocks";
import type { LandingFormField, LandingVersionContent } from "@/lib/landing/types";

export type LandingTemplateId = "direto" | "consideracao" | "oferta";

export type LandingTemplate = {
  id: LandingTemplateId;
  name: string;
  summary: string;
  /** Quando escolher este — texto que a interface mostra para o cliente decidir. */
  bestFor: string;
  build: (params: LandingTemplateSeed) => LandingVersionContent;
};

export type LandingTemplateSeed = {
  businessName: string;
  /** O que o negócio faz, em uma linha. Vem da configuração do agente. */
  proposition: string;
  /** Ação que a pessoa faz na página (ex.: "receber uma proposta"). */
  desiredAction: string;
  city?: string | null;
  formFields?: LandingFormField[];
};

function seedDefaults(seed: LandingTemplateSeed) {
  const business = seed.businessName.trim() || "A nossa equipa";
  const proposition = seed.proposition.trim() || "Atendimento rápido e direto pelo WhatsApp.";
  const action = seed.desiredAction.trim() || "falar com a nossa equipa";
  const place = seed.city?.trim() ? ` em ${seed.city.trim()}` : "";
  const fields = seed.formFields?.length ? seed.formFields : defaultLandingFormFields();
  return { business, proposition, action, place, fields };
}

const CONSENT =
  "Autorizo o contacto por WhatsApp, telefone e e-mail sobre esta solicitação.";

export const LANDING_TEMPLATES: LandingTemplate[] = [
  {
    id: "direto",
    name: "Contacto direto",
    summary: "Uma dobra, formulário no topo, zero distração.",
    bestFor:
      "Pesquisa no Google com intenção alta — quem já sabe o que quer e só precisa de falar com alguém.",
    build: (seed) => {
      const { business, proposition, action, place, fields } = seedDefaults(seed);
      return {
        blocks: [
          {
            kind: "hero",
            eyebrow: "Resposta em minutos",
            headline: `${business}${place}`,
            subheadline: proposition,
            ctaLabel: "Falar agora",
          },
          {
            kind: "form",
            title: `Preencha para ${action}`,
            description: "Respondemos pelo WhatsApp assim que recebermos.",
            submitLabel: "Quero falar agora",
            successMessage: "Recebemos o seu contacto. Já vamos falar consigo no WhatsApp.",
            consentText: CONSENT,
          },
          {
            kind: "benefits",
            title: "Como funciona",
            items: [
              { title: "Você preenche", description: "Leva menos de um minuto, só o essencial." },
              { title: "Nós respondemos", description: "O contacto chega no WhatsApp, sem fila de espera." },
              { title: "Resolvemos", description: "Um responsável acompanha do início ao fim." },
            ],
          },
          { kind: "footer", businessName: business, legalLine: "" },
        ],
        theme: DEFAULT_LANDING_THEME,
        seo: {
          title: `${business}${place}`.slice(0, 70),
          description: proposition.slice(0, 160),
          indexable: false,
        },
        formFields: fields,
      };
    },
  },
  {
    id: "consideracao",
    name: "Decisão pensada",
    summary: "Explica, prova e responde objeção antes de pedir o contacto.",
    bestFor:
      "Compra de valor alto ou serviço que a pessoa ainda está a avaliar — precisa de confiança antes do formulário.",
    build: (seed) => {
      const { business, proposition, action, place, fields } = seedDefaults(seed);
      return {
        blocks: [
          {
            kind: "hero",
            eyebrow: "Atendimento com pessoa de verdade",
            headline: `${business}${place}`,
            subheadline: proposition,
            ctaLabel: "Ver como funciona",
          },
          {
            kind: "benefits",
            title: "O que você recebe",
            items: [
              { title: "Diagnóstico antes da proposta", description: "Entendemos o caso antes de falar de preço." },
              { title: "Um responsável só seu", description: "Nada de recomeçar a conversa a cada contacto." },
              { title: "Prazo combinado", description: "Você sabe o que acontece e quando." },
            ],
          },
          {
            kind: "proof",
            title: "Quem já passou por aqui",
            items: [
              { quote: "Resolveram em dias o que estava parado há meses.", author: "Cliente" },
              { quote: "Atendimento rápido e sem enrolação.", author: "Cliente" },
            ],
          },
          {
            kind: "faq",
            title: "Antes de preencher",
            items: [
              { question: "Tem custo para falar?", answer: "Não. O primeiro contacto e a avaliação são gratuitos." },
              { question: "Em quanto tempo respondem?", answer: "No mesmo dia, pelo WhatsApp que você informar." },
              { question: "Vou receber ligação insistente?", answer: "Não. Falamos pelo WhatsApp e só quando você responder." },
            ],
          },
          {
            kind: "form",
            title: `Preencha para ${action}`,
            description: "Só o essencial. O resto conversamos no WhatsApp.",
            submitLabel: "Quero uma avaliação",
            successMessage: "Recebemos o seu contacto. Já vamos falar consigo no WhatsApp.",
            consentText: CONSENT,
          },
          { kind: "footer", businessName: business, legalLine: "" },
        ],
        theme: DEFAULT_LANDING_THEME,
        seo: {
          title: `${business}${place}`.slice(0, 70),
          description: proposition.slice(0, 160),
          indexable: false,
        },
        formFields: fields,
      };
    },
  },
  {
    id: "oferta",
    name: "Oferta com prazo",
    summary: "Uma condição específica, repetida no topo e no fim.",
    bestFor: "Campanha com condição, vaga limitada ou data — quando existe um motivo real para decidir hoje.",
    build: (seed) => {
      const { business, proposition, action, place, fields } = seedDefaults(seed);
      return {
        blocks: [
          {
            kind: "hero",
            eyebrow: "Condição por tempo limitado",
            headline: `${business}${place}`,
            subheadline: proposition,
            ctaLabel: "Quero a condição",
          },
          {
            kind: "benefits",
            title: "O que está incluído",
            items: [
              { title: "Condição desta campanha", description: "Válida enquanto a campanha estiver no ar." },
              { title: "Sem compromisso", description: "Você fala connosco e decide depois." },
            ],
          },
          {
            kind: "form",
            title: `Preencha para ${action}`,
            description: "Confirmamos a condição no WhatsApp.",
            submitLabel: "Garantir condição",
            successMessage: "Recebemos o seu contacto. Já vamos falar consigo no WhatsApp.",
            consentText: CONSENT,
          },
          {
            kind: "cta",
            headline: "Ainda dá tempo",
            description: "Preencha acima e confirmamos a disponibilidade para o seu caso.",
            ctaLabel: "Voltar ao formulário",
          },
          { kind: "footer", businessName: business, legalLine: "" },
        ],
        theme: DEFAULT_LANDING_THEME,
        seo: {
          title: `${business}${place}`.slice(0, 70),
          description: proposition.slice(0, 160),
          indexable: false,
        },
        formFields: fields,
      };
    },
  },
];

export function findLandingTemplate(id: unknown): LandingTemplate {
  const value = typeof id === "string" ? id.trim().toLowerCase() : "";
  return LANDING_TEMPLATES.find((template) => template.id === value) ?? LANDING_TEMPLATES[0];
}

export function buildLandingTemplateContent(
  id: unknown,
  seed: LandingTemplateSeed,
): LandingVersionContent {
  return findLandingTemplate(id).build(seed);
}
