export type DashboardNavItem = {
  href: string;
  label: string;
  /** Título no cabeçalho do painel quando diferente do rótulo do menu. */
  headerTitle?: string;
  short: string;
  masterOnly?: boolean;
  routeKey: string;
  help: DashboardNavHelp;
};

export type DashboardNavHelp = {
  title: string;
  summary: string;
  items?: readonly string[];
  example?: string;
};

export type DashboardNavGroup = {
  title: string;
  items: DashboardNavItem[];
};

/** Itens sempre visíveis no topo da sidebar (sem título de secção). */
export const dashboardNavPinnedItems: DashboardNavItem[] = [
  {
    href: "/dashboard",
    label: "Relatório",
    short: "VG",
    routeKey: "overview",
    help: {
      title: "Relatório",
      summary: "Mostra uma visão geral da operação no período selecionado, sem alterar nenhum registro.",
      items: [
        "Acompanhe leads, conversas, desempenho e tendências.",
        "Use o filtro de datas para comparar períodos.",
        "Os indicadores resumem dados já registrados nas demais ferramentas.",
      ],
    },
  },
  {
    href: "/dashboard/crm",
    label: "CRM Kanban",
    short: "CRM",
    routeKey: "crm",
    help: {
      title: "CRM Kanban",
      summary: "Organiza os leads por funil e etapa para acompanhar cada oportunidade do primeiro contato ao fechamento.",
      items: [
        "Mova leads entre etapas e consulte a ficha completa.",
        "Histórico, origem, agente, follow-ups e conversas ficam vinculados ao lead.",
        "Contatos espontâneos só entram no CRM quando uma regra autoriza ou quando você salva manualmente.",
      ],
    },
  },
  {
    href: "/dashboard/ofertas-ativas",
    label: "Ofertas ativas",
    short: "OA",
    routeKey: "ofertas-ativas",
    help: {
      title: "Ofertas ativas",
      summary: "Listas de ligação inteligentes para reativar leads e distribuir contatos entre vendedores.",
      items: [
        "Diretor e dono montam listas com filtros (etapa, dias sem contato, responsável).",
        "Vendedores trabalham a fila com botões de resultado que atualizam o CRM.",
        "Acompanhe pendências, transferências e leads que pediram para não ligar.",
      ],
    },
  },
  {
    href: "/dashboard/agentes",
    label: "Agentes",
    short: "AG",
    routeKey: "agentes",
    help: {
      title: "Agentes de IA",
      summary: "Crie e configure os agentes que atendem seus contatos conforme as instruções do seu negócio.",
      items: [
        "Defina identidade, instruções, tempo de resposta, agenda, handoff e follow-up.",
        "Cada agente usa apenas suas próprias instruções e materiais.",
        "Ativar um agente não autoriza todas as origens: a autorização vem das regras em Integrações de Leads.",
      ],
    },
  },
  {
    href: "/dashboard/conversas",
    label: "Conversas",
    headerTitle: "Conversas em tempo real (WhatsApp)",
    short: "CV",
    routeKey: "conversas",
    help: {
      title: "Conversas",
      summary: "Centraliza as conversas do WhatsApp e mostra quando o atendimento está com a IA ou com uma pessoa.",
      items: [
        "Consulte mensagens, mídias, agente responsável e estado do atendimento.",
        "Responda manualmente e transfira ou retome a automação quando permitido.",
        "Conversas ainda sem lead podem ser salvas no CRM pelo próprio painel.",
      ],
    },
  },
  {
    href: "/dashboard/integracoes-leads",
    label: "Integrações de Leads",
    headerTitle: "Configurações para distribuição de leads",
    short: "IL",
    routeKey: "integracoes-leads",
    help: {
      title: "Integrações de Leads",
      summary: "Define de onde cada lead vem, como os campos serão mapeados e quem poderá atendê-lo.",
      items: [
        "Escolha formulário, página, conexão ou entrada direta autorizada.",
        "Mapeie nome, telefone, e-mail e respostas para o CRM.",
        "Somente regras ativas e explícitas autorizam agentes e distribuições automáticas.",
      ],
      example: "Um formulário de recrutamento pode usar o agente de RH, enquanto outro formulário no mesmo número usa um agente comercial.",
    },
  },
  {
    href: "/dashboard/colaboradores",
    label: "Colaboradores",
    headerTitle: "Colaboradores que recebem leads",
    short: "EQ",
    routeKey: "colaboradores",
    help: {
      title: "Colaboradores",
      summary: "Cadastre a equipe humana que pode receber leads, tarefas e responsabilidades.",
      items: [
        "Organize diretores, gerentes e vendedores.",
        "Use os colaboradores nas regras de distribuição de leads.",
        "Os acessos e limites respeitam a estrutura da organização.",
      ],
    },
  },
  {
    href: "/dashboard/disparos",
    label: "Disparos em Massa",
    short: "DM",
    routeKey: "disparos",
    help: {
      title: "Disparos em Massa",
      summary: "Crie campanhas de WhatsApp para públicos autorizados e acompanhe cada tentativa de envio.",
      items: [
        "Escolha conexão, público, mensagem e agendamento.",
        "Destinatários da campanha são vinculados ao CRM.",
        "Um agente pode ser associado para tratar respostas da campanha, quando configurado.",
      ],
    },
  },
  {
    href: "/dashboard/agenda",
    label: "Agenda",
    short: "AD",
    routeKey: "agenda",
    help: {
      title: "Agenda",
      summary: "Mostra compromissos da operação e permite criar, editar, remarcar ou cancelar eventos.",
      items: [
        "Visualize por calendário e consulte dados do contato.",
        "Agentes autorizados podem consultar a agenda pelo telefone do lead.",
        "Lembretes de agenda seguem as configurações do evento e do agente.",
      ],
    },
  },
  {
    href: "/dashboard/lembretes",
    label: "Lembretes",
    short: "LB",
    routeKey: "lembretes",
    help: {
      title: "Lembretes",
      summary: "Reúne avisos e tarefas que precisam de atenção para evitar contatos ou compromissos esquecidos.",
      items: [
        "Consulte pendências operacionais e próximos prazos.",
        "Um lembrete informa o que fazer; ele não envia mensagens por conta própria sem uma automação configurada.",
      ],
    },
  },
  {
    href: "/dashboard/integracoes",
    label: "Integrações",
    short: "IN",
    routeKey: "integracoes",
    help: {
      title: "Integrações",
      summary: "Conecta os serviços externos usados pelo MyChatCRM, como WhatsApp, Meta e Google.",
      items: [
        "Acompanhe status, conecte e desconecte contas.",
        "A conexão fornece o canal de transporte.",
        "Quem atende e em qual situação é definido nas regras de Integrações de Leads.",
      ],
    },
  },
  {
    href: "/dashboard/suporte",
    label: "Suporte",
    short: "SP",
    routeKey: "suporte",
    help: {
      title: "Suporte",
      summary: "Encontre orientações e canais de ajuda para usar ou solucionar problemas no MyChatCRM.",
      items: [
        "Consulte materiais disponíveis antes de abrir um atendimento.",
        "Envie informações claras do problema para agilizar o diagnóstico.",
      ],
    },
  },
];

export const dashboardSettingsHelp: DashboardNavHelp = {
  title: "Configurações",
  summary: "Gerencie os dados da conta, plano, notificações, segurança e preferências do painel.",
  items: [
    "Atualize nome, e-mail e telefones com as verificações de segurança.",
    "Escolha o número que recebe notificações operacionais do sistema.",
    "Consulte plano, cobrança e opções de proteção da conta.",
  ],
};

/** Secções colapsáveis (vazio: Integrações e Suporte passaram para o bloco fixo acima). */
export const dashboardNavGroups: DashboardNavGroup[] = [];

export function getDashboardRouteLabel(routeKey: string) {
  if (routeKey === "configuracoes") return "Configurações";
  const pinned = dashboardNavPinnedItems.find((entry) => entry.routeKey === routeKey);
  if (pinned) return pinned.headerTitle ?? pinned.label;
  for (const group of dashboardNavGroups) {
    const item = group.items.find((entry) => entry.routeKey === routeKey);
    if (item) return item.headerTitle ?? item.label;
  }
  return "Painel do cliente";
}
