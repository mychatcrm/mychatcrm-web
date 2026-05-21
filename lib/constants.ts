import type { ClientRow, Conversation, LeadMetric, PaymentRow, Plan, Ticket } from "./types";
import { BRAND } from "./brand";
import { WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL } from "./plans";

const DEFAULT_SITE_URL = "https://www.mychatcrm.com.br";

/** Garante URL absoluta válida para `metadataBase` / Open Graph (evita crash se a env vier sem protocolo). */
function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim() || DEFAULT_SITE_URL;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^localhost|^127\./i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return new URL(DEFAULT_SITE_URL).origin;
  }
}

export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL);

export const NAV_LINKS = [
  { href: "/#recursos", label: "Recursos" },
  { href: "/planos", label: "Planos" },
  { href: "/blog", label: "Blog" },
  { href: "/#video", label: "Vídeo" },
  { href: "/#faq", label: "Dúvidas" },
] as const;

export const FEATURES = [
  {
    title: "Atendimento 24h",
    description:
      "Respostas rápidas e padronizadas, reduzindo perda de leads fora do horário comercial.",
    icon: "clock",
  },
  {
    title: "Responde em Áudio",
    description:
      "Entende áudios e responde em texto e áudio, com múltiplas vozes para combinar com sua marca.",
    icon: "mic",
  },
  {
    title: "Treinamento por Especialistas",
    description:
      "Configuração e ajustes finos feitos por nós para máxima performance no seu segmento.",
    icon: "spark",
  },
  {
    title: "Integrações Avançadas",
    description:
      "Envios e consultas via API, automações e conexões com sistemas externos do seu ecossistema.",
    icon: "plug",
  },
  {
    title: "Funil + Follow-up",
    description:
      "Formulários, pipeline e follow-up automático para aumentar conversão em cada etapa.",
    icon: "funnel",
  },
  {
    title: "CRM Kanban + Agenda",
    description:
      "Gestão completa com etiquetas, CRM Kanban e integração com Google Agenda.",
    icon: "grid",
  },
] as const;

export const HOW_STEPS = [
  {
    title: "Conecte seu WhatsApp",
    description: "Integração via API Oficial da Meta, com segurança e conformidade.",
  },
  {
    title: "Treine a IA com nossos especialistas",
    description: "Alimentamos o assistente com as informações do seu negócio e segmento.",
  },
  {
    title: "Venda no piloto automático",
    description: "Atenda e feche negócios 24 horas por dia com qualificação inteligente.",
  },
] as const;

export const TESTIMONIALS = [
  {
    name: "Mariana Souza",
    role: "Diretora Comercial",
    company: "Clínica Vida Plena",
    quote:
      "Triplicamos o retorno de leads em 60 dias. O MyChatCRM entende nosso protocolo e encaminha certo para o CRM Kanban.",
    image: "https://i.pravatar.cc/150?img=12",
  },
  {
    name: "Ricardo Almeida",
    role: "CEO",
    company: "TechParts Distribuidora",
    quote:
      "CRM Kanban + follow-up automático mudou o jogo. Hoje sabemos exatamente onde cada oportunidade está.",
    image: "https://i.pravatar.cc/150?img=33",
  },
  {
    name: "Fernanda Lima",
    role: "Head de CX",
    company: "Solar Brasil Energia",
    quote:
      "A IA responde áudios e manda lembretes na agenda. Nossa equipe foca só no que realmente precisa de humano.",
    image: "https://i.pravatar.cc/150?img=45",
  },
  {
    name: "Paulo Henrique",
    role: "Fundador",
    company: "Imobiliária Horizonte",
    quote:
      "Profissional, rápido e com suporte que entende de vendas. Recomendo para qualquer time comercial.",
    image: "https://i.pravatar.cc/150?img=52",
  },
  {
    name: "Camila Rocha",
    role: "COO",
    company: "Educa+ Cursos",
    quote:
      "Os formulários de qualificação filtram curiosos. Só entram no funil quem tem fit real.",
    image: "https://i.pravatar.cc/150?img=68",
  },
  {
    name: "Diego Martins",
    role: "Gerente de Vendas",
    company: "AutoPrime Peças",
    quote:
      "Integração com API externa sincronizou estoque e pedidos. Menos erro, mais velocidade.",
    image: "https://i.pravatar.cc/150?img=70",
  },
] as const;

export const FAQ_ITEMS = [
  {
    q: "O MyChatCRM usa a API oficial do WhatsApp?",
    a: "Sim. Trabalhamos com a API oficial da Meta (WhatsApp Business), garantindo entregabilidade, segurança e conformidade com as políticas da plataforma.",
  },
  {
    q: "Preciso ter conhecimento técnico para usar?",
    a: "Não. O painel é intuitivo e nosso time cuida da configuração inicial, integrações e treinamento da IA para o seu segmento.",
  },
  {
    q: "Como funciona o treinamento por especialistas?",
    a: "Coletamos informações do seu negócio, materiais e objeções frequentes. Em seguida, ajustamos prompts, tom de voz e fluxos até a IA performar no padrão que você espera.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim. Planos são mensais e você pode solicitar cancelamento conforme os termos do contrato, sem letras miúdas.",
  },
  {
    q: "O bot responde áudios dos clientes?",
    a: "Sim. O assistente interpreta áudios recebidos e pode responder em texto ou áudio, com vozes configuráveis.",
  },
  {
    q: "Funciona para qualquer tipo de negócio?",
    a: "Atendemos diversos segmentos. A performance depende do volume de conversas e da qualidade das informações fornecidas no treinamento — e ajudamos você nisso.",
  },
  {
    q: "Quantos números de WhatsApp posso conectar?",
    a: `Todos os planos incluem 1 número na API oficial da Meta. Pode adicionar mais números: cada um extra custa R$ ${WHATSAPP_EXTRA_NUMBER_MONTHLY_BRL}/mês, somado à assinatura.`,
  },
  {
    q: "Como é feita a integração com Google Agenda?",
    a: "Conectamos via OAuth, sincronizamos eventos e podemos enviar lembretes pelo WhatsApp conforme regras que você definir.",
  },
] as const;

export const KANBAN_COLUMNS = [
  { id: "novo", title: "Novo Lead" },
  { id: "contato", title: "Em Contato" },
  { id: "proposta", title: "Proposta Enviada" },
  { id: "negociacao", title: "Negociação" },
  { id: "fechado", title: "Fechado ✓" },
  { id: "perdido", title: "Perdido ✗" },
] as const;

/** Datas fixas (evita divergência SSR/cliente se o módulo for avaliado nos dois lados). */
export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "c1",
    contact: "Cliente — Marina (Clínica)",
    preview: "Gostaria de agendar uma avaliação esta semana.",
    status: "aberta",
    updatedAt: "2026-04-16T15:00:00.000Z",
  },
  {
    id: "c2",
    contact: "Cliente — João (Distribuidora)",
    preview: "Vocês integram com ERP próprio?",
    status: "manual",
    updatedAt: "2026-04-16T14:00:00.000Z",
  },
  {
    id: "c3",
    contact: "Cliente — Carla (Solar)",
    preview: "Perfeito, pode enviar a proposta por e-mail.",
    status: "resolvida",
    updatedAt: "2026-04-15T15:00:00.000Z",
  },
  {
    id: "c4",
    contact: "Cliente — Felipe (Imóveis)",
    preview: "Tem plantão de 2 quartos na zona sul?",
    status: "aberta",
    updatedAt: "2026-04-16T14:58:00.000Z",
  },
  {
    id: "c5",
    contact: "Cliente — Amanda (Cursos)",
    preview: "Quero migrar do plano básico para o master.",
    status: "aberta",
    updatedAt: "2026-04-16T13:00:00.000Z",
  },
];

const CONVERSATIONS_CHART_ANCHOR = new Date("2026-04-16T12:00:00.000Z");

export const CONVERSATIONS_BY_DAY: LeadMetric[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(CONVERSATIONS_CHART_ANCHOR);
  d.setUTCDate(d.getUTCDate() - (29 - i));
  return {
    day: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }),
    count: 20 + Math.round(35 * Math.sin(i / 4) + ((i * 17) % 19)),
  };
});

export const MRR_GROWTH = Array.from({ length: 12 }, (_, i) => ({
  month: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][i],
  mrr: 120_000 + i * 18_500 + ((i * 523 + 1) % 8000),
}));

export const PLAN_DISTRIBUTION = [
  { name: "Profissional", value: 58, fill: BRAND.orange },
  { name: "Master", value: 42, fill: BRAND.orangeDark },
];

export const MOCK_ADMIN_PLANS: Plan[] = [
  {
    id: "p1",
    name: "Profissional",
    priceMonthly: 269.9,
    subscriberCount: 512,
    status: "ativo",
    monthlyLeadLimit: 5_000,
    features: [
      "Atendimento 24h",
      "Treinamento por especialistas",
      "Cota mensal de leads atendidos",
      "Respostas em texto e áudio",
    ],
    displayOrder: 1,
  },
  {
    id: "p2",
    name: "Master",
    priceMonthly: 369.9,
    subscriberCount: 318,
    status: "ativo",
    monthlyLeadLimit: 15_000,
    features: [
      "Tudo do Profissional",
      "CRM Kanban",
      "Agenda de eventos",
      "Envio em massa",
    ],
    badge: "Mais escolhido",
    highlight: true,
    displayOrder: 2,
  },
];

export const MOCK_CLIENTS: ClientRow[] = [
  {
    id: "cl1",
    name: "Marina Duarte",
    email: "marina@vidaplena.com.br",
    company: "Clínica Vida Plena",
    plan: "Master",
    status: "ativo",
    signupAt: "2025-08-12",
    nextCharge: "2026-05-12",
    leadsAttendedThisMonth: 8_200,
    monthlyLeadLimit: 15_000,
  },
  {
    id: "cl2",
    name: "João Prado",
    email: "joao@techparts.com.br",
    company: "TechParts",
    plan: "Profissional",
    status: "ativo",
    signupAt: "2025-11-03",
    nextCharge: "2026-05-03",
    leadsAttendedThisMonth: 3_200,
    monthlyLeadLimit: 5_000,
  },
  {
    id: "cl3",
    name: "Carla Menezes",
    email: "carla@solarbrasil.com",
    company: "Solar Brasil",
    plan: "Master",
    status: "inadimplente",
    signupAt: "2025-04-22",
    nextCharge: "2026-04-22",
    leadsAttendedThisMonth: 13_200,
    monthlyLeadLimit: 15_000,
  },
  {
    id: "cl4",
    name: "Felipe Rocha",
    email: "felipe@horizonte.imo",
    company: "Imobiliária Horizonte",
    plan: "Profissional",
    status: "cancelado",
    signupAt: "2024-12-01",
    nextCharge: "2026-01-01",
    leadsAttendedThisMonth: 800,
    monthlyLeadLimit: 5_000,
  },
];

export const MOCK_PAYMENTS: PaymentRow[] = [
  {
    id: "pay1",
    clientName: "Marina Duarte",
    amount: 369.9,
    plan: "Master",
    status: "pago",
    date: "2026-04-12",
  },
  {
    id: "pay2",
    clientName: "João Prado",
    amount: 269.9,
    plan: "Profissional",
    status: "pago",
    date: "2026-04-11",
  },
  {
    id: "pay3",
    clientName: "Carla Menezes",
    amount: 369.9,
    plan: "Master",
    status: "falhou",
    date: "2026-04-10",
  },
  {
    id: "pay4",
    clientName: "Amanda Costa",
    amount: 269.9,
    plan: "Profissional",
    status: "pendente",
    date: "2026-04-09",
  },
];

export const MOCK_TICKETS: Ticket[] = [
  {
    id: "t1",
    clientName: "Solar Brasil",
    subject: "Erro ao sincronizar Google Agenda",
    priority: "alta",
    status: "aberto",
    openedAt: "2026-04-14T09:12:00",
    messages: [
      {
        author: "Carla Menezes",
        body: "Alguns eventos não aparecem no painel após a última atualização.",
        at: "2026-04-14T09:12:00",
      },
    ],
  },
  {
    id: "t2",
    clientName: "TechParts",
    subject: "Dúvida sobre limite de leads",
    priority: "media",
    status: "em_andamento",
    openedAt: "2026-04-13T16:40:00",
    messages: [
      {
        author: "João Prado",
        body: "Como acompanho o consumo diário?",
        at: "2026-04-13T16:40:00",
      },
      {
        author: "Suporte MyChatCRM",
        body: "No menu Configurações > Uso você vê o consumo detalhado.",
        at: "2026-04-13T17:05:00",
      },
    ],
  },
  {
    id: "t3",
    clientName: "Clínica Vida Plena",
    subject: "Solicitação de novo fluxo de triagem",
    priority: "baixa",
    status: "resolvido",
    openedAt: "2026-04-10T11:00:00",
    messages: [
      {
        author: "Marina Duarte",
        body: "Podemos adicionar uma pergunta sobre convênio?",
        at: "2026-04-10T11:00:00",
      },
    ],
  },
];
