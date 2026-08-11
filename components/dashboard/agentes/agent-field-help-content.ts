/** Textos dos tooltips (?) dos campos do wizard/modal de agente. */
export const AGENT_FIELD_HELP = {
  // ── Identidade ──────────────────────────────────────────────────────────────
  nome: 'Como o agente é identificado no painel. Escolha um nome fácil de reconhecer pela equipe. Ex.: "Ana – Vendas" ou "Bot Suporte RH"',

  cor: 'Cor que representa este agente na lista e nos cards do painel. Use a cor da sua marca para manter consistência visual. Ex.: laranja para o time comercial, azul para suporte',

  avatar: "Ícone visual do agente. Facilita identificar rapidamente qual bot é qual quando há vários agentes criados.",

  // ── SmartWait ───────────────────────────────────────────────────────────────
  smartWaitAtivar:
    'Esta proteção fica sempre ativa: o agente espera o contato terminar uma sequência curta de mensagens, consolida o contexto e envia uma única resposta coerente. Os tempos abaixo continuam personalizáveis',

  smartWaitInicial:
    'Tempo de espera após a primeira mensagem do cliente. Dá espaço para o cliente continuar digitando antes do agente começar a processar. Ex.: 7 segundos — o agente aguarda 7s após a primeira mensagem',

  smartWaitNovaMsg:
    'Se o cliente mandar outra mensagem durante a espera, o temporizador reinicia. Garante que o agente sempre leia tudo antes de responder. Ex.: com 10 segundos, cada nova mensagem reinicia a contagem do zero',

  smartWaitMaxima:
    'Limite máximo de espera, independente de quantas mensagens o cliente enviar. Evita que o agente espere indefinidamente. Ex.: 30 segundos — após esse tempo, o agente responde mesmo que o cliente ainda esteja digitando',

  smartWaitDedupe:
    'Ignora mensagens idênticas enviadas em sequência antes do agente responder. Evita processar a mesma mensagem duas vezes por cliques acidentais. Ex.: cliente aperta "Enviar" duas vezes com a mesma frase — o agente trata como uma só',

  // ── Tom e comportamento ──────────────────────────────────────────────────────
  tom: 'Estilo de linguagem que o agente usa ao se comunicar. Afeta o vocabulário, o nível de formalidade e o calor humano das respostas. Ex.: "Formal", "Casual" ou "Técnico", conforme as instruções do seu atendimento',

  velocidade:
    'Atraso simulado antes do agente enviar a resposta, para parecer mais humano e menos robótico. O cliente verá "digitando…" antes da mensagem aparecer. Ex.: 2 segundos de delay — mais natural em atendimentos comerciais',

  idioma:
    'Idioma preferencial das respostas do agente. "Automático" detecta e responde no idioma que o cliente estiver usando. Ex.: configure "Português" se quiser garantir respostas sempre em PT-BR, mesmo que o cliente escreva em outro idioma',

  temperatura:
    'Controla o quanto a IA varia suas respostas. Baixo = mais direto, consistente e previsível. Alto = mais criativo e variado a cada resposta. Ex.: 0,2 para máxima consistência; 0,7 para mais variedade',

  // ── Instruções ──────────────────────────────────────────────────────────────
  modoInstrucoes:
    'Escolha como configurar as instruções do agente. Simples = um único bloco de texto; Pro = campos separados (identidade, objetivo, regras). Ex.: comece no Simples para ir rápido e migre para Pro quando precisar de mais controle',

  promptSimples:
    "Escreva tudo sobre o agente em um único texto livre: quem ele é, como fala, o que pode e não pode fazer. É o campo mais importante do agente e a única fonte para definir o escopo do atendimento.",

  identidade:
    'Como o agente se apresenta ao cliente. Inclua nome, organização e estilo de comunicação. Ex.: "Sou a Sofia, assistente virtual da sua empresa. Me comunico de forma objetiva e amigável em português"',

  objetivo:
    'Meta do agente em texto livre. Descreve o resultado que ele deve buscar em cada conversa. Ex.: "Entender a necessidade do contato, responder dúvidas e oferecer o próximo passo configurado"',

  instrucoes:
    'Comportamento principal do agente: quais perguntas fazer, como conduzir a conversa, quando pedir para um humano assumir. É o campo mais importante para definir a qualidade das respostas. Pode apagar o modelo e colar o seu próprio texto.',

  regrasAdicionais:
    'Políticas e preferências específicas do seu negócio que complementam as instruções principais. Ex.: "Confirmar a cidade antes de informar preços; não listar mais de 3 opções por resposta; sempre se despedir pelo primeiro nome"',

  respostasProibidas:
    'Lista do que o agente nunca deve dizer ou fazer. Quanto mais claro, melhor. Ex.: "Não mencionar a empresa concorrente X; não prometer desconto acima de 10%; não dar informações de prazo de entrega sem confirmar com a equipe"',

  // ── Materiais ───────────────────────────────────────────────────────────────
  materiaisApoio:
    'Documentos que o agente lê para responder com precisão e consistência. Ideal para tabelas de preços, manuais e FAQs. Ex.: tabela de preços em PDF, catálogo de produtos, perguntas frequentes. Suporta PDF, Word, Excel e outros. Até 5 arquivos',

  arquivosEnvio:
    'Arquivos que o agente envia diretamente no WhatsApp quando o cliente pede ou quando faz sentido na conversa. Ex.: imagem, catálogo, documento em PDF ou vídeo de apresentação. Até 50 arquivos por agente',

  // ── Handoff ─────────────────────────────────────────────────────────────────
  handoffAtivar:
    "Define se o agente pode transferir a conversa para atendimento humano. Quando desativado, o agente informa que não há atendimento humano disponível no momento.",

  handoffNumero:
    'WhatsApp do atendente que receberá a notificação quando houver uma transferência. Inclua o código do país. Ex.: 5562999999999 (Brasil, Goiás)',

  // ── CRM ─────────────────────────────────────────────────────────────────────
  crmModo:
    'Define se leads atendidos por este agente são movidos automaticamente para uma etapa do funil do CRM. Mantém o pipeline atualizado sem trabalho manual.',

  crmFunil:
    'Funil do CRM onde o lead será posicionado quando a regra automática estiver ativa. Ex.: o funil principal configurado para este agente',

  crmColuna:
    'Etapa dentro do funil escolhido onde o lead será colocado. Ex.: "Qualificado" — o lead entra automaticamente nesta etapa ao interagir com o agente',

  crmNaoMover:
    'O lead é criado ou atualizado no CRM normalmente, mas não é movido de funil nem de etapa automaticamente. Útil quando você quer registrar o contato sem alterar o estágio atual do lead.',

  crmMover:
    'Todo lead que interagir com este agente é posicionado automaticamente no funil e etapa escolhidos abaixo. Ex.: novos leads do WhatsApp vão direto para a etapa "Qualificado" no funil de vendas',

  crmRegraBackend:
    'Esta configuração se aplica apenas aos leads do seu espaço de trabalho vinculados a este agente. Não afeta outros agentes nem outras contas.',

  crmRespostaNaoMover:
    'O lead permanece na mesma etapa quando responder. Use quando o primeiro contato já coloca o card onde você quer e você prefere mover daí em diante à mão.',

  crmRespostaMover:
    'Quando o lead responder pela primeira vez, o card muda para o funil e etapa escolhidos abaixo — separando quem já respondeu de quem ainda não. Acontece uma única vez: se depois alguém mover o card à mão, as próximas mensagens do lead não o trazem de volta.',

  crmRespostaFunil:
    'Funil onde o lead será posicionado ao responder pela primeira vez. Pode ser o mesmo do primeiro contato ou outro.',

  crmRespostaColuna:
    'Etapa dentro do funil escolhido para onde o card vai quando o lead responder pela primeira vez.',

  // ── Follow-up A) Ativação ────────────────────────────────────────────────────
  followUpAtivar:
    'Ativa o sistema de retomada automática de conversas sem resposta. O agente cria mensagens personalizadas com base no histórico real da conversa — sem textos genéricos. Respeita horário comercial, cooldown anti-spam e atendimento humano ativo. Ex.: cliente não responde há 2 horas → agente retoma citando exatamente o que foi discutido',

  // ── Follow-up B) Frequência ──────────────────────────────────────────────────
  followUpTentativas:
    'Quantas vezes o agente tentará retomar a conversa antes de parar completamente. Após esgotar as tentativas, o follow-up encerra para este lead. Ex.: 3 tentativas — se o cliente não responder após 3 follow-ups, o agente para automaticamente',

  followUpIntervalo:
    'Tempo mínimo que o agente aguarda entre cada verificação de follow-up. O agente não envia mensagens com mais frequência do que este intervalo. Ex.: 60 minutos — o agente verifica a cada hora se o cliente ainda não respondeu',

  followUpModo:
    'Tom das mensagens de retomada. Suave = gentil e sem pressão, deixa o cliente no comando. Moderado = contextual e equilibrado, retoma de forma natural. Agressivo = cria urgência legítima e pede uma decisão. Ex.: use Suave para clientes frios e Agressivo para negociações avançadas próximas do fechamento',

  followUpCooldownAtivo:
    'Ativa um intervalo mínimo obrigatório entre dois follow-ups enviados para o mesmo lead. Evita que o agente apareça como insistente ou spam. Ex.: com cooldown ativo de 24 horas, o agente nunca manda dois follow-ups para a mesma pessoa no mesmo dia',

  followUpCooldown:
    'Tempo mínimo em minutos entre follow-ups consecutivos para o mesmo lead. Valor padrão recomendado: 1440 (24 horas). Ex.: 1440 minutos = 1 dia entre cada tentativa de retomada',

  followUpDesativarAposEncerrar:
    'Após esgotar todas as tentativas, marca o follow-up como inativo para este lead e remove o próximo agendamento. Garante que o agente não reinicie o ciclo automaticamente. Ex.: 3 tentativas sem resposta → ciclo de follow-up encerrado e não reiniciado para este lead',

  // ── Follow-up C) Horários ────────────────────────────────────────────────────
  followUpHorarioComercial:
    'Restringe o envio de follow-ups à janela de horário e dias configurados abaixo. Fora do horário, o agente aguarda e reagenda automaticamente para o próximo slot permitido. Ex.: configurado para 08:00–22:00 → follow-up das 23:00 é enviado somente no dia seguinte às 08:00',

  followUpHorario:
    'Horário de início e fim da janela em que os follow-ups podem ser enviados. Use hora e minuto. Se o horário final for menor que o inicial, a janela atravessa a meia-noite. Ex.: 08:00 às 22:00 para horário comercial; 22:00 às 08:00 para janela noturna',

  followUpDias:
    'Dias da semana em que os follow-ups podem ser enviados, quando a restrição de horário comercial está ativa. Ex.: marcar Seg–Sex para evitar contato automático no fim de semana',

  // ── Follow-up D) Regras de segurança ────────────────────────────────────────
  followUpSlaAtivo:
    'Quando ativo, o agente prioriza a retomada de leads que ficaram sem resposta por mais tempo do que o SLA configurado. Garante que nenhum cliente espere além do prazo acordado. Ex.: SLA de 4 horas — qualquer lead sem resposta há mais de 4h recebe prioridade máxima no follow-up',

  followUpSla:
    'Horas sem resposta que caracterizam uma violação de SLA para este agente. Após esse tempo, a tentativa de retomada recebe prioridade máxima. Ex.: 4 horas — cliente sem resposta por mais de 4h é tratado como urgente',

  followUpRespeitarHumano:
    'Bloqueia o follow-up automático quando um atendente humano está ativo na conversa — seja porque pausou o agente, está no modo humano ou respondeu recentemente. Evita interferência em atendimentos manuais em andamento. Ex.: a equipe está respondendo no WhatsApp → agente pausa e aguarda',

  followUpSoHumano:
    'O agente só retoma automaticamente se um atendente humano estava respondendo e ficou sem responder pelo tempo configurado abaixo. Ideal para recuperar leads abandonados após transferências. Ex.: atendente assumiu o chat e desapareceu — o agente volta após o tempo configurado',

  followUpRetomadaApos:
    'Tempo mínimo sem resposta do atendente para o agente retomar a conversa. Só vale quando "Retomar só se humano abandonou" está ativo. Deixe em branco para não aplicar restrição de tempo. Ex.: 2 horas — se o atendente não responder em 2 horas, o agente volta a falar com o cliente',

  followUpBloquearRespondeu:
    'Cancela o follow-up automaticamente se o cliente já respondeu depois que o job foi agendado. Evita que o agente envie uma mensagem desnecessária quando o cliente voltou por conta própria. Ex.: agente estava prestes a enviar o follow-up mas o cliente acabou de mandar "oi" — o job é cancelado',

  followUpBloquearTarefa:
    'Não envia follow-up se já houver uma tarefa manual de follow-up agendada no CRM para este lead. Evita duplicidade com ações manuais da equipe. Ex.: vendedor agendou uma ligação no CRM para amanhã → o agente não envia mensagem automática neste período',

  followUpBloquearPerdido:
    'Não envia follow-up para leads com status perdido, inativo, cancelado ou arquivado. Evita contato desnecessário com clientes que já saíram do funil. Ex.: lead marcado como "Perdido" → agente para de tentar retomá-lo automaticamente',

  // ── Follow-up E) Inteligência ────────────────────────────────────────────────
  followUpHistoricoWhatsapp:
    'Inclui as mensagens anteriores do WhatsApp no contexto usado pela IA para gerar o follow-up. Torna as mensagens muito mais personalizadas e relevantes. Ex.: a IA lembra a última dúvida do cliente e usa isso ao retomar a conversa',

  followUpHistoricoCrm:
    'Inclui informações do CRM — resumo do lead, notas e estágio no funil — no contexto da IA. Permite que o agente retome com inteligência sobre o histórico completo do cliente e use somente os dados registrados',

  followUpMetaForm:
    'Inclui os dados preenchidos no formulário do Meta Lead Ads no contexto da IA. Permite personalizar o follow-up usando somente o que o lead informou ao se cadastrar',

  // ── Modo de resposta e voz ───────────────────────────────────────────────────
  modoResposta:
    'Define como o agente responde no WhatsApp. Texto = mensagens escritas normais. Áudio = o agente grava um áudio usando a voz configurada via ElevenLabs. Ex.: use Áudio para atendimentos mais pessoais, como consultoria ou vendas de alto valor',

  vozAgente:
    'Voz usada quando o modo Áudio está ativo. Ouça a prévia antes de salvar para garantir que soa natural e coerente com o tom configurado para o agente',

  previewIdioma:
    'Idioma da prévia de voz exibida nesta tela. Não altera o idioma das respostas reais no WhatsApp — serve apenas para testar como a voz soa em diferentes idiomas.',

  // ── Outros ──────────────────────────────────────────────────────────────────
  simulacao:
    'Testa como o agente responderia a uma conversa real, sem enviar nada no WhatsApp nem criar lead algum. Ideal para validar prompts e fluxos antes de ativar o agente. Ex.: simule uma conversa de compra para verificar se o agente está seguindo as instruções corretamente',
} as const;
