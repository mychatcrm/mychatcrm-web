/**
 * Conteúdo da página de agendamento.
 *
 * Todas as respostas do agente aqui são o texto REAL que
 * `lib/server/agent-cta-scheduler.ts` devolve naquele estado
 * (`AGENDA_*_REPLY` / `buildOutsideAvailabilityReply`), e cada `motivo` é um
 * `AgendaTechnicalReplyCode` que existe no motor. Se o motor mudar uma
 * resposta, este ficheiro tem de mudar junto — é a fonte da verdade da página.
 *
 * Universal de propósito: "atendimento", nunca consulta/visita/aula. O mesmo
 * ciclo serve para qualquer negócio que marque hora com alguém.
 */

export type TipoSituacao = "protege" | "resolve";

export type Situacao = {
  id: string;
  /** Rótulo curto, o que o cliente fez. */
  tag: string;
  /**
   * "protege" = o agente RECUSA e explica. É o grupo que vende: o medo de
   * quem contrata não é o robô ser lento, é ele marcar besteira.
   * "resolve" = o agente executa sozinho.
   */
  tipo: TipoSituacao;
  /** Código técnico do motor — mostrado como prova, não como enfeite. */
  motivo: string;
  pergunta?: string;
  /** Quando não há cliente a escrever (o lembrete parte do relógio). */
  gatilho?: string;
  resposta: string;
  /** O que ficou feito, em ordem. */
  fez: string[];
};

export const SITUACOES: Situacao[] = [
  {
    id: "fora-da-janela",
    tag: "Pede um horário em que você não atende",
    tipo: "protege",
    motivo: "outside_availability",
    pergunta: "Pode ser domingo às 22h?",
    resposta:
      "Esse horário fica fora da nossa janela de agendamento. Atendemos de segunda a sexta, das 09:00 às 18:00. Me diga outra data ou horário dentro desse período que eu confirmo para você.",
    fez: ["Nada foi criado", "Janela real explicada", "Lead continua na conversa"],
  },
  {
    id: "ocupado",
    tag: "Pede um horário já tomado",
    tipo: "protege",
    motivo: "slot_taken",
    pergunta: "Terça às 14h então.",
    resposta:
      "Esse horário acabou de ficar indisponível na nossa agenda. Pode me indicar outra data ou horário? Eu verifico a disponibilidade e confirmo na hora.",
    fez: ["Agenda conferida antes de prometer", "Nada foi criado", "Sem marcação por cima"],
  },
  {
    id: "passado",
    tag: "Pede um dia que já passou",
    tipo: "protege",
    motivo: "past_datetime",
    pergunta: "Ah, então dia 12 de manhã.",
    resposta: "Esse horário já passou. Me diga outro dia e horário que eu verifico para você.",
    fez: ["Comparado com hoje no seu fuso", "Nada foi criado", "Corrigido sem constranger"],
  },
  {
    id: "proposta",
    tag: "Propõe e espera o sim",
    tipo: "protege",
    motivo: "confirmation_required",
    pergunta: "Quinta às 10h dá?",
    resposta: "Quinta, dia 4, às 10:00 está livre. Confirmo esse horário para você?",
    fez: ["Agenda intacta até o sim", "Card parado no CRM", "Proposta expira sozinha"],
  },
  {
    id: "chega",
    tag: "Chega sem dizer quando",
    tipo: "resolve",
    motivo: "datetime_required",
    pergunta: "Oi! Queria marcar um atendimento com vocês.",
    resposta:
      "Não consegui identificar a data e o horário certinhos. Me diga o dia e a hora que você prefere (por exemplo: 20/07 às 14h) que eu verifico para você.",
    fez: ["Contato criado no CRM", "Atendido na hora", "Pergunta que falta, feita"],
  },
  {
    id: "confirmado",
    tag: "Confirma o horário",
    tipo: "resolve",
    motivo: "schedule_confirmed",
    pergunta: "Pode ser, confirma.",
    resposta: "Pronto, seu agendamento foi confirmado.",
    fez: [
      "Compromisso criado na agenda",
      "Card movido para Agendado",
      "Lembretes agendados",
      "Você avisado no WhatsApp",
    ],
  },
  {
    id: "consulta",
    tag: "Pergunta que horas era mesmo",
    tipo: "resolve",
    motivo: "agenda_listed",
    pergunta: "Me lembra que horas era mesmo?",
    resposta: "Seu atendimento está marcado para quinta, dia 4, às 10:00.",
    fez: ["Agenda consultada", "Nada alterado", "Sem ninguém procurar"],
  },
  {
    id: "remarcado",
    tag: "Precisa mudar de dia",
    tipo: "resolve",
    motivo: "reschedule_confirmed",
    pergunta: "Surgiu uma coisa, consigo passar para sexta às 16h?",
    resposta: "Pronto, seu agendamento foi remarcado.",
    fez: [
      "Horário antigo liberado",
      "Horário novo ocupado",
      "Lembretes antigos cancelados e refeitos",
    ],
  },
  {
    id: "lembrete",
    tag: "Chega a hora do lembrete",
    tipo: "resolve",
    motivo: "reminder",
    gatilho: "24 horas antes do atendimento — ninguém apertou nada",
    resposta:
      "Oi Marina! Passando para lembrar do seu atendimento amanhã, sexta, às 16:00. Se precisar remarcar é só me falar por aqui.",
    fez: ["Até 3 lembretes por compromisso", "Mensagem definida por você", "Compromisso inalterado"],
  },
  {
    id: "cancelado",
    tag: "Cancela",
    tipo: "resolve",
    motivo: "cancellation_confirmed",
    pergunta: "Infelizmente vou precisar cancelar.",
    resposta: "Pronto, cancelei seu agendamento.",
    fez: [
      "Horário liberado para outra pessoa",
      "Card movido para Cancelado",
      "Lembretes cancelados",
      "Você avisado",
    ],
  },
];

/**
 * As promessas negativas. Quem contrata um agente de agendamento não tem medo
 * de ele ser lento — tem medo de ele marcar besteira na frente do cliente.
 * Cada uma vem com o mecanismo, senão é só promessa.
 */
export const NUNCA = [
  {
    titulo: "Nunca marca dois no mesmo horário",
    como: "Ele lê a sua agenda no momento de confirmar, não no momento em que a conversa começou. Se o horário caiu no meio da conversa, ele avisa em vez de marcar por cima.",
  },
  {
    titulo: "Nunca marca fora do seu expediente",
    como: "Você define os dias e a janela. Fora disso ele recusa e explica qual é a janela real — sem perder o lead.",
  },
  {
    titulo: "Nunca grava nada sem o sim",
    como: "Ele propõe o horário e para. A agenda fica intacta e o card não anda enquanto a pessoa não confirmar. A proposta expira sozinha se ela sumir.",
  },
  {
    titulo: "Nunca inventa um horário",
    como: "Só oferece o que está livre de verdade na sua agenda. Data no passado é comparada com hoje no fuso da sua operação e recusada.",
  },
  {
    titulo: "Nunca deixa você por fora",
    como: "Marcou, remarcou ou cancelou, você recebe no WhatsApp com nome, telefone, data e hora. O card no CRM anda junto.",
  },
];

export const PASSOS = [
  {
    n: "01",
    titulo: "Ligue o seu WhatsApp",
    texto: "O número que os seus clientes já conhecem. Sem trocar de linha e sem app novo para eles.",
  },
  {
    n: "02",
    titulo: "Diga quando você atende",
    texto: "Dias, janela de horário, duração do atendimento e até três lembretes por compromisso.",
  },
  {
    n: "03",
    titulo: "Pronto — ele atende",
    texto: "A partir daí ele responde na hora, confere a agenda, confirma e move o card. Você só aparece na hora marcada.",
  },
];

export const PERGUNTAS = [
  {
    q: "E se o cliente escrever de um jeito estranho?",
    a: "O agente entende data e hora escritas de qualquer jeito — “amanhã de manhã”, “dia 20 às 14h”, “quinta que vem”. Quando fica ambíguo, ele não adivinha: pergunta de novo com um exemplo.",
  },
  {
    q: "Ele mexe na minha agenda do Google?",
    a: "Sim, se você conectar. O compromisso entra e sai da sua Google Agenda junto com o que acontece na conversa. Sem conectar, a agenda vive dentro do MyChatCRM.",
  },
  {
    q: "Preciso ficar de plantão para conferir?",
    a: "Não. Ele só marca o que cabe na janela que você definiu e no horário que está livre. Você recebe o aviso de cada marcação, remarcação e cancelamento no WhatsApp.",
  },
  {
    q: "E quando o cliente quer falar com uma pessoa?",
    a: "Você configura a palavra ou a situação que passa para o humano. O agente avisa a sua equipe e para de responder aquela conversa até alguém assumir.",
  },
  {
    q: "Funciona para o meu tipo de negócio?",
    a: "Se o seu negócio marca hora com alguém, funciona. O agente é configurado com as suas palavras, o seu horário e as suas regras — não vem com um roteiro pronto de um ramo específico.",
  },
  {
    q: "Quanto tempo leva para ligar?",
    a: "A configuração do agendamento é feita em minutos no painel: dias, janela, duração e lembretes. Conectar o WhatsApp é o passo mais demorado e leva poucos minutos.",
  },
];
