import type { PanelHelpContent } from "@/components/panel/ui/PanelHelp";
import type { ActiveOfferDisposition } from "@/lib/active-offers-types";
import { ACTIVE_OFFER_DISPOSITION_LABELS } from "@/lib/active-offers-types";

export const ACTIVE_OFFERS_HELP = {
  pageIntro: {
    title: "Listas de ligação",
    summary: "Aqui você organiza contatos para a equipe ligar e registrar o resultado de cada ligação.",
    items: [
      "Dono e diretor montam a lista com filtros do CRM.",
      "Vendedores veem só as listas liberadas para eles.",
      "Cada resultado da ligação atualiza o lead no CRM automaticamente.",
    ],
  },
  novaLista: {
    title: "Nova lista",
    summary: "Abre o assistente em 3 passos: escolher quem entra, conferir a quantidade e definir quem vai ligar.",
  },
  comoFunciona: {
    title: "Como funciona",
    summary: "Fluxo rápido para montar uma campanha de ligações na sua base.",
    items: [
      "Passo 1 — Escolha quem entra (etapa do CRM, tempo sem contato, responsável).",
      "Passo 2 — Veja quantos contatos foram encontrados antes de criar.",
      "Passo 3 — Escolha quais vendedores vão ligar e como a fila será dividida.",
    ],
  },
  passoFiltrar: {
    title: "Passo 1 — Quem entra na lista",
    summary: "Use os filtros abaixo para definir quais leads entram nesta lista de ligação.",
  },
  passoPreview: {
    title: "Passo 2 — Conferir quantidade",
    summary: "Veja quantos contatos batem com os filtros antes de liberar para a equipe.",
  },
  passoDistribuir: {
    title: "Passo 3 — Quem vai ligar",
    summary: "Dê um nome à lista, escolha os vendedores e como a fila será organizada.",
  },
  etapasCrm: {
    title: "Etapas do CRM",
    summary: "Selecione uma ou mais etapas do funil. Se nenhuma estiver marcada, entram leads de todas as etapas.",
    example: "Marque “Perdido” para reativar contatos que já foram encerrados.",
  },
  diasSemContato: {
    title: "Tempo sem contato",
    summary: "Mostra só quem não fala com você há pelo menos esse período.",
    example: "365 dias = contatos parados há cerca de 1 ano, ideais para campanhas de reativação.",
  },
  responsavel: {
    title: "Responsável atual",
    summary: "Filtra leads que hoje estão na base de vendedores específicos. Deixe vazio para não filtrar por responsável.",
  },
  semResponsavel: {
    title: "Incluir sem responsável",
    summary: "Inclui leads que ainda não têm vendedor definido no CRM.",
  },
  preview: {
    title: "Quantidade encontrada",
    summary: "Número total de contatos que entram na lista. O limite por lista é de 5.000 contatos.",
    items: [
      "A amostra abaixo mostra alguns exemplos — não é a lista completa.",
      "Se houver mais contatos do que o limite, os mais antigos sem contato entram primeiro.",
    ],
  },
  tituloLista: {
    title: "Nome da lista",
    summary: "Título que os vendedores verão na lateral. Use algo claro, como “Reativação base 2024”.",
  },
  vendedores: {
    title: "Quem pode ligar",
    summary: "Define quais vendedores enxergam e trabalham esta lista.",
  },
  vendedoresTodos: {
    title: "Todos os vendedores",
    summary: "Qualquer vendedor ativo da equipe pode ver e ligar para os contatos desta lista.",
  },
  vendedoresEscolhidos: {
    title: "Vendedores selecionados",
    summary: "Somente os vendedores marcados abaixo terão acesso a esta lista.",
  },
  modoDistribuicao: {
    title: "Como organizar a fila",
    summary: "Escolha se todos ligam na mesma fila ou se cada vendedor recebe uma parte fixa dos contatos.",
  },
  modoFilaCompartilhada: {
    title: "Fila compartilhada",
    summary: "Todos os vendedores veem a mesma fila. Quem estiver livre pega o próximo contato.",
  },
  modoDividirIgual: {
    title: "Dividir por vendedor",
    summary: "Os contatos são repartidos automaticamente entre os vendedores escolhidos.",
    items: [
      "Funciona melhor quando você seleciona vendedores específicos.",
      "Cada um vê só a parte que foi atribuída a ele.",
    ],
  },
  progressoGeral: {
    title: "Acompanhamento da lista",
    summary: "Resumo de quantos contatos já foram ligados, quantos faltam e o resultado de cada ligação.",
  },
  arquivar: {
    title: "Arquivar lista",
    summary: "Encerra a lista para os vendedores. O histórico e os resultados permanecem salvos.",
  },
  filaVendedor: {
    title: "Suas listas",
    summary: "Listas que o diretor ou dono liberou para você. Toque em uma para começar a ligar.",
  },
  proximoContato: {
    title: "Próximo contato",
    summary: "Este é o contato que você deve ligar agora. Use o botão “Ligar agora” para abrir o telefone.",
  },
  ligarAgora: {
    title: "Ligar agora",
    summary: "Abre o discador do celular com o número do contato. No computador, pode abrir o app de chamadas padrão.",
  },
  observacao: {
    title: "Observação",
    summary: "Opcional. Anote detalhes da ligação — a observação pode ir para o CRM junto com o resultado.",
  },
  naoAtendeu: {
    title: "Não atendeu",
    summary: "Use quando ninguém atendeu ou a ligação caiu na caixa postal.",
    items: [
      "O contato continua na sua fila para tentar de novo depois.",
      "A contagem de tentativas aumenta em 1.",
    ],
  },
  transferir: {
    title: "Atendeu — transferir para minha base",
    summary: "Use quando o cliente atendeu e você vai assumir o atendimento.",
    items: [
      "O lead passa a ser seu responsável no CRM.",
      "A ligação é marcada como concluída nesta lista.",
    ],
  },
  naoQuer: {
    title: "Atendeu — não quer nada",
    summary: "Use quando o cliente atendeu, ouviu a proposta e não tem interesse.",
    items: [
      "O lead vai para a etapa “Perdido” no CRM.",
      "A ligação é marcada como concluída nesta lista.",
    ],
  },
  naoLigar: {
    title: "Pediu para não ligar",
    summary: "Use quando o cliente pediu explicitamente para não receber mais ligações.",
    items: [
      "Registra que não deve ser contatado por telefone.",
      "A ligação é marcada como concluída nesta lista.",
    ],
  },
  pularContato: {
    title: "Pular por agora",
    summary: "Avança para o próximo contato sem registrar resultado. O atual continua na fila.",
  },
  porVendedor: {
    title: "Desempenho por vendedor",
    summary: "Veja quantos contatos cada vendedor já finalizou e quantos ainda faltam nesta lista.",
  },
  leadsAmostra: {
    title: "Contatos da lista",
    summary: "Amostra dos leads vinculados. O status mostra o resultado da ligação, quando já registrado.",
  },
} satisfies Record<string, PanelHelpContent>;

export function dispositionLabel(disposition: ActiveOfferDisposition | string): string {
  if (disposition in ACTIVE_OFFER_DISPOSITION_LABELS) {
    return ACTIVE_OFFER_DISPOSITION_LABELS[disposition as ActiveOfferDisposition];
  }
  return "Pendente";
}

export function createdViaLabel(createdVia: string | undefined): string {
  if (createdVia === "smart_filter") return "Criada com filtros";
  return "Criada pelo CRM";
}
