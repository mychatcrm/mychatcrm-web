import { BRAND } from "@/lib/brand";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";
import type { Agent } from "@/lib/types";

function buildMockQrData(keyword: string) {
  const cells = Array.from({ length: 9 * 9 }, (_, index) => ((index + keyword.length * 7) * 19) % 4 === 0);
  const pixel = 8;
  const size = 9 * pixel;
  const rects = cells
    .map((on, index) => {
      if (!on) return "";
      const x = (index % 9) * pixel;
      const y = Math.floor(index / 9) * pixel;
      return `<rect x="${x}" y="${y}" width="${pixel}" height="${pixel}" />`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="#111827"><rect width="${size}" height="${size}" fill="#ffffff"/>${rects}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Três agentes modelo por tenant — nomes alinhados aos leads demo em `lib/dashboard-data.ts` (Clara, Max, Luma).
 * Fonte única para o catálogo demo; workers futuros devem ler via `listAgentsForTenant` / persistência real.
 */
export function buildTemplateAgentsForTenant(clientId: string): Agent[] {
  const stamp = "2026-04-17T12:00:00.000Z";
  const funilBase = {
    funilId: "funil-default",
    nomeFunil: "Funil Principal",
    colunaInicial: "novo" as const,
    tagsEntrada: ["whatsapp", "demo"],
    origemRelatorio: "Modelo MyChatCRM",
    valorEstimado: 0,
    slaHoras: 4,
    maxFollowUps: 0,
  };

  return [
    {
      id: "ag-clara-comercial",
      clientId,
      nome: "Clara · Comercial",
      nomeProduto: "Modelo: qualificar leads e primeiro atendimento",
      avatar: "phone",
      cor: BRAND.orange,
      genero: "feminino",
      objetivo: "qualificar",
      status: "ativo",
      tom: "Consultivo e acolhedor",
      delayResposta: 2,
      temperatura: 0.2,
      promptIdentidade:
        "Sou a Clara, primeira linha comercial; apresento-me pelo nome, confirmo que falo em nome da empresa e mantenho tom consultivo e acolhedor.",
      promptObjetivo:
        "Ser o primeiro contato: entender motivação, medir fit e preparar o lead para o time comercial sem prometer o que não estiver publicado.",
      systemPrompt:
        "Você é Clara, especialista em primeiro contato comercial. Colete necessidade, orçamento aproximado e urgência; ofereça próximo passo claro (demo, proposta ou humano). Registre tudo para o CRM. Nunca invente preços fechados.",
      promptRegrasAdicionais:
        "Mensagens curtas; uma pergunta por vez quando possível. Se o lead pedir humano, confirme e faça a transição com contexto resumido.",
      arquivosTreinamento: [
        { id: "cl-t1", nome: "roteiro-qualificacao.pdf", tipo: "pdf", status: "ativo", tamanhoKb: 420 },
        { id: "cl-t2", nome: "objeções-comuns.txt", tipo: "txt", status: "ativo", tamanhoKb: 64 },
      ],
      respostasProibidas: "Não prometer desconto sem regra publicada. Não enviar dados de outros clientes.",
      idioma: "Português BR",
      whatsappSlotIndex: 0,
      comandoPausaConversa: "Oi cheguei",
      comandoRetomaConversa: "Oi ainda tem interesse?",
      origens: [
        {
          tipo: "lead_ads",
          ativo: true,
          config: {
            formIds: ["META_DEMO"],
            enviarPrimeiro: true,
            delayPrimeiro: 1,
            mensagemInicial: "Olá! Vi seu interesse. Em uma frase: o que você busca resolver agora?",
          },
        },
        { tipo: "organico", ativo: true, config: {} },
        {
          tipo: "keyword",
          ativo: true,
          config: {
            keywords: [
              {
                id: "kw-clara-1",
                tipo: "contem",
                keyword: "COMERCIAL",
                link: "https://wa.me/5562999999999?text=COMERCIAL",
                qrCode: buildMockQrData("COMERCIAL"),
              },
            ],
          },
        },
      ],
      horario: {
        tipo: "comercial",
        diasAtivos: ["seg", "ter", "qua", "qui", "sex"],
        mensagemForaHorario: "Estamos fora do horário; deixe sua mensagem que retomamos no próximo dia útil.",
      },
      fluxo: [
        {
          id: "cl-f1",
          nome: "Boas-vindas",
          objetivo: "Entender motivação e segmento",
          perguntas: ["O que te levou a falar conosco hoje?", "Você já usa alguma solução parecida?"],
          condicaoAvancar: "perguntas",
          acoesAoCompletar: [{ id: "cl-a1", tipo: "tag", valor: "primeiro-contato" }],
          ordem: 1,
        },
        {
          id: "cl-f2",
          nome: "Qualificação rápida",
          objetivo: "Medir fit e urgência",
          perguntas: ["Qual tamanho aproximado da operação?", "Precisa de resposta ainda esta semana?"],
          condicaoAvancar: "perguntas",
          acoesAoCompletar: [{ id: "cl-a2", tipo: "kanban", valor: "novo" }],
          ordem: 2,
        },
      ],
      funil: { ...funilBase, tagsEntrada: ["inbound", "qualificacao"] },
      followUps: [],
      followUpInteligente: { ...DEFAULT_FOLLOW_UP_INTELIGENTE },
      metricas: {
        conversasHoje: 14,
        leadsConvertidos: 5,
        taxaResposta: 95.2,
        handoffRate: 11,
        satisfacaoMedia: 4.7,
        tempoMedioMin: 5,
        conversasAtivasAgora: 2,
        ultimaAtividade: "Há 3 minutos",
      },
      criadoEm: stamp,
      atualizadoEm: stamp,
    },
    {
      id: "ag-max-vendas",
      clientId,
      nome: "Max · Vendas",
      nomeProduto: "Modelo: apresentar valor, demo e fechamento",
      avatar: "target",
      cor: BRAND.orangeDark,
      genero: "masculino",
      objetivo: "vender",
      status: "ativo",
      tom: "Direto e orientado a resultado",
      delayResposta: 2,
      temperatura: 0.2,
      promptIdentidade:
        "Sou o Max, closer virtual; vou direto ao ponto com respeito, deixo claro que posso agendar demo ou passar para um humano em negociação sensível.",
      promptObjetivo:
        "Conduzir oportunidades quentes: reforçar valor, tratar objeções e fechar próximo passo (demo, proposta ou assinatura) com clareza.",
      systemPrompt:
        "Você é Max, closer comercial. Aprofunde valor percebido, trate objeções com empatia e conduza para demonstração ou proposta. Use materiais oficiais. Escale para humano em negociação final sensível.",
      promptRegrasAdicionais:
        "Sempre ancorar benefícios em casos de uso do cliente. Se não souber um detalhe contratual, diga que vai confirmar com o time.",
      arquivosTreinamento: [
        { id: "mx-t1", nome: "deck-comercial.pdf", tipo: "pdf", status: "ativo", tamanhoKb: 980 },
        { id: "mx-t2", nome: "tabela-planos.csv", tipo: "csv", status: "processando", tamanhoKb: 32 },
      ],
      respostasProibidas: "Não garantir prazo legal sem revisão humana. Não criticar concorrentes pelo nome.",
      idioma: "Português BR",
      whatsappSlotIndex: 0,
      origens: [
        { tipo: "ctw", ativo: true, config: { adIds: ["CTW_DEMO"] } },
        {
          tipo: "keyword",
          ativo: true,
          config: {
            keywords: [
              {
                id: "kw-max-1",
                tipo: "contem",
                keyword: "ORCAMENTO",
                link: "https://wa.me/5562999999999?text=ORCAMENTO",
                qrCode: buildMockQrData("ORCAMENTO"),
              },
            ],
          },
        },
        { tipo: "organico", ativo: true, config: {} },
      ],
      horario: { tipo: "sempre", diasAtivos: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] },
      fluxo: [
        {
          id: "mx-f1",
          nome: "Diagnóstico de compra",
          objetivo: "Mapear decisor e critério",
          perguntas: ["Quem mais participa da decisão?", "O que seria sucesso para você em 30 dias?"],
          condicaoAvancar: "perguntas",
          acoesAoCompletar: [{ id: "mx-a1", tipo: "tag", valor: "oportunidade" }],
          ordem: 1,
        },
        {
          id: "mx-f2",
          nome: "Demonstração",
          objetivo: "Agendar demo curta",
          perguntas: ["Prefere demo pela manhã ou à tarde?"],
          condicaoAvancar: "mensagens",
          acoesAoCompletar: [{ id: "mx-a2", tipo: "notificar_humano", valor: "SDR" }],
          ordem: 2,
        },
      ],
      funil: { ...funilBase, tagsEntrada: ["demo", "vendas"], valorEstimado: 12000 },
      followUps: [],
      followUpInteligente: { ...DEFAULT_FOLLOW_UP_INTELIGENTE },
      metricas: {
        conversasHoje: 9,
        leadsConvertidos: 3,
        taxaResposta: 92.4,
        handoffRate: 18,
        satisfacaoMedia: 4.5,
        tempoMedioMin: 8,
        conversasAtivasAgora: 1,
        ultimaAtividade: "Há 12 minutos",
      },
      criadoEm: stamp,
      atualizadoEm: stamp,
    },
    {
      id: "ag-luma-suporte",
      clientId,
      nome: "Luma · Suporte",
      nomeProduto: "Modelo: dúvidas, pós-venda e retorno ao cliente",
      avatar: "wrench",
      cor: "#2c4a6e",
      genero: "feminino",
      objetivo: "suporte",
      status: "ativo",
      tom: "Didático e calmo",
      delayResposta: 1,
      temperatura: 0.2,
      promptIdentidade:
        "Sou a Luma, suporte virtual; explico com calma, confirmo o entendimento antes de passos longos e digo quando o caso precisa de um atendente humano.",
      promptObjetivo:
        "Reduzir atrito: responder dúvidas, orientar uso da solução e encaminhar com segurança quando o assunto exigir humano.",
      systemPrompt:
        "Você é Luma, focada em suporte e relacionamento. Resolva dúvidas frequentes, confirme dados e abra handoff quando houver reclamação, cancelamento ou pedido contratual. Sempre confirme o entendimento antes de encerrar.",
      promptRegrasAdicionais:
        "Confirmar o problema em uma frase antes de longas explicações. Oferecer link ou material oficial quando existir.",
      arquivosTreinamento: [
        { id: "lm-t1", nome: "faq-suporte.pdf", tipo: "pdf", status: "ativo", tamanhoKb: 560 },
      ],
      respostasProibidas: "Não cancelar planos pelo chat. Não pedir senha ou chaves de API completas.",
      idioma: "Português BR",
      whatsappSlotIndex: 0,
      origens: [
        { tipo: "crm", ativo: true, config: {} },
        {
          tipo: "keyword",
          ativo: true,
          config: {
            keywords: [
              {
                id: "kw-luma-1",
                tipo: "igual",
                keyword: "AJUDA",
                link: "https://wa.me/5562999999999?text=AJUDA",
                qrCode: buildMockQrData("AJUDA"),
              },
            ],
          },
        },
        { tipo: "organico", ativo: true, config: {} },
      ],
      horario: {
        tipo: "comercial",
        diasAtivos: ["seg", "ter", "qua", "qui", "sex"],
        mensagemForaHorario: "Nosso time retorna no próximo horário útil. Deixei seu pedido registrado.",
      },
      fluxo: [
        {
          id: "lm-f1",
          nome: "Triagem",
          objetivo: "Classificar tipo de solicitação",
          perguntas: ["É sobre cobrança, uso da plataforma ou outro assunto?"],
          condicaoAvancar: "perguntas",
          acoesAoCompletar: [{ id: "lm-a1", tipo: "tag", valor: "suporte" }],
          ordem: 1,
        },
        {
          id: "lm-f2",
          nome: "Resolução guiada",
          objetivo: "Resolver ou encaminhar",
          perguntas: ["Conseguiu seguir o passo a passo?"],
          condicaoAvancar: "mensagens",
          acoesAoCompletar: [{ id: "lm-a2", tipo: "notificar_humano", valor: "N1" }],
          ordem: 2,
        },
      ],
      funil: { ...funilBase, tagsEntrada: ["suporte", "pos-venda"], valorEstimado: 0, slaHoras: 2 },
      followUps: [],
      followUpInteligente: { ...DEFAULT_FOLLOW_UP_INTELIGENTE },
      metricas: {
        conversasHoje: 21,
        leadsConvertidos: 1,
        taxaResposta: 97.1,
        handoffRate: 22,
        satisfacaoMedia: 4.6,
        tempoMedioMin: 7,
        conversasAtivasAgora: 3,
        ultimaAtividade: "Há 6 minutos",
      },
      criadoEm: stamp,
      atualizadoEm: stamp,
    },
  ];
}
