/** Textos dos tooltips (?) dos campos do wizard/modal de agente. */
export const AGENT_FIELD_HELP = {
  nome: 'Como seu agente será identificado internamente. Ex.: "Ana - Atendimento" ou "Bot Vendas"',
  cor: 'Cor usada no painel para identificar o agente. Ex.: laranja da marca da sua empresa',
  avatar: 'Ícone exibido na lista de agentes. Escolha o que melhor representa o papel do bot.',
  whatsappLinha:
    'Linha WhatsApp que este agente usa para responder. Configure cada linha em Integrações → WhatsApp (QR ou API oficial). Ex.: "Linha 1" para vendas',
  smartWaitAtivar:
    'Aguarda o cliente terminar de digitar antes de responder. Ex.: se mandar 3 mensagens seguidas, o agente responde tudo de uma vez',
  smartWaitInicial: 'Segundos de espera após a primeira mensagem do cliente. Ex.: 7 segundos',
  smartWaitNovaMsg: 'Se o cliente mandar outra mensagem nesse intervalo, o timer reinicia. Ex.: 10 segundos',
  smartWaitMaxima: 'Tempo máximo total de espera antes de responder. Ex.: 30 segundos',
  smartWaitDedupe: 'Ignora mensagens repetidas iguais antes de montar a resposta.',
  tom: 'Como o agente se comunica. Ex.: Formal para empresas, Casual para lojas, Técnico para suporte',
  velocidade: 'Atraso simulado antes de enviar a resposta, para parecer mais humano. Ex.: 1–3 segundos',
  idioma: 'Idioma preferencial das respostas. "Automático" detecta o idioma do cliente.',
  modoInstrucoes:
    'Simples = um único texto; Pro = campos separados (identidade, objetivo, instruções). Ex.: comece no Simples e migre para Pro depois',
  promptSimples:
    'Tudo sobre o agente num só lugar: quem é, como fala, o que pode e não pode fazer. Ex.: "Sou consultor da loja X, tom amigável..."',
  identidade:
    'Como o agente se apresenta. Ex.: "Sou a assistente virtual da empresa X; falo em português claro"',
  objetivo:
    'Meta do agente em texto livre. Ex.: "Converter visitantes do WhatsApp em reuniões com o time comercial"',
  instrucoes:
    'Comportamento principal: passos, tom, quando pedir humano. Pode apagar o modelo e colar o seu.',
  regrasAdicionais:
    'Políticas extras opcionais. Ex.: "Confirmar cidade antes de passar preço; listas com no máximo 3 itens"',
  respostasProibidas:
    'O que o agente não deve dizer. Ex.: "Não mencionar concorrentes nem prometer desconto acima de 5%"',
  temperatura:
    'Criatividade das respostas. Baixo = mais direto e previsível. Alto = mais variado. Ex.: 0,2 para suporte, 0,7 para vendas',
  materiaisApoio:
    'PDFs e documentos que o agente lê para responder. Ex.: tabela de preços, manual do produto. Até 5 ficheiros, 1 GB no total',
  arquivosEnvio:
    'Fotos, vídeos e ficheiros que o agente envia no WhatsApp. Ex.: fotos do produto, contrato em PDF. Até 50 ficheiros por agente',
  handoffAtivar: 'Detecta quando o cliente quer falar com uma pessoa e avisa a equipe.',
  handoffKeywords: 'Palavras que disparam a transferência. Ex.: "humano", "atendente", "falar com pessoa"',
  handoffNumero: 'WhatsApp do atendente (com DDI). Ex.: 5562999999999',
  handoffMensagem: 'O que o agente diz antes de passar para o humano. Ex.: "Vou te conectar com nosso especialista"',
  ctaFinal: 'Ação principal que o agente deve buscar na conversa. Ex.: agendar reunião ou transferir para humano',
  crmModo: 'Define se leads deste agente são movidos automaticamente no funil do CRM.',
  crmFunil: 'Funil onde o lead será colocado quando a regra automática estiver ativa.',
  crmColuna: 'Coluna/etapa do funil para posicionar o lead. Ex.: "Qualificado"',
  followUpAtivar:
    'Retoma conversas sem resposta usando o histórico — sem mensagens genéricas fixas. Ex.: lembrar o orçamento pendente',
  followUpTentativas: 'Quantas vezes tentar contato de novo. Ex.: 3 tentativas',
  followUpIntervalo: 'De quanto em quanto tempo verificar conversas paradas. Ex.: 60 minutos',
  modoResposta: 'Texto = mensagens normais; Áudio = resposta falada via ElevenLabs.',
  vozAgente: 'Voz usada no TTS quando o modo Áudio está ativo. Ouça a prévia antes de salvar.',
  simulacao: 'Testa a resposta do agente sem enviar WhatsApp nem criar lead real.',
  crmNaoMover: 'Cria ou atualiza o lead sem mudar funil nem coluna automaticamente.',
  crmMover: 'Sempre posiciona o lead na funil e coluna escolhidas abaixo.',
  crmRegraBackend:
    'A regra só vale para leads do seu tenant quando a conversa tiver este agente identificado.',
  previewIdioma: 'Idioma usado só na prévia de voz no painel — não altera o idioma das respostas no WhatsApp.',
} as const;
