/**
 * O ciclo de vida de um agendamento, ato a ato.
 *
 * Cada resposta do agente aqui é o texto REAL que `lib/server/agent-cta-scheduler.ts`
 * devolve naquele estado (`AGENDA_*_REPLY` / `buildOutsideAvailabilityReply`), e
 * cada `reason` é um `AgendaTechnicalReplyCode` que existe no motor. Se o motor
 * mudar uma resposta, esta página tem de mudar junto — é a fonte da verdade.
 *
 * Universal de propósito: "atendimento", nunca consulta/visita/aula. O mesmo
 * ciclo serve para qualquer negócio que marque hora com alguém.
 */

export type AgendaSlotState = "livre" | "ocupado" | "proposto" | "marcado" | "bloqueado";

export type Act = {
  id: string;
  /** Rótulo curto do separador. */
  label: string;
  /** Código técnico do motor — mostrado como prova, não como enfeite. */
  reason: string;
  title: string;
  body: string;
  /** Linha de sistema quando não há mensagem do cliente (lembrete automático). */
  systemLine?: string;
  inbound?: string;
  reply: string;
  /** O que o motor fez, em ordem. */
  trace: string[];
  /** Estado da grelha da agenda depois deste ato. */
  slots: Record<string, AgendaSlotState>;
  /** Coluna do card no CRM (índice em CRM_COLUMNS). */
  crmColumn: number;
  /** Marca o movimento do card neste ato. */
  crmMoved?: boolean;
  /** Efeitos que acontecem sem ninguém tocar em nada. */
  effects?: string[];
};

export const CRM_COLUMNS = ["Novo", "Em conversa", "Agendado", "Cancelado"] as const;

/** Grelha de exemplo: 4 dias × 3 horários. As chaves são "dia-hora". */
export const AGENDA_DAYS = ["Ter", "Qua", "Qui", "Sex"] as const;
export const AGENDA_HOURS = ["10:00", "14:00", "16:00"] as const;

const LIVRE: Record<string, AgendaSlotState> = {
  "Ter-10:00": "livre",
  "Ter-14:00": "ocupado",
  "Ter-16:00": "livre",
  "Qua-10:00": "livre",
  "Qua-14:00": "livre",
  "Qua-16:00": "ocupado",
  "Qui-10:00": "livre",
  "Qui-14:00": "livre",
  "Qui-16:00": "livre",
  "Sex-10:00": "livre",
  "Sex-14:00": "ocupado",
  "Sex-16:00": "livre",
};

const g = (over: Record<string, AgendaSlotState>) => ({ ...LIVRE, ...over });

/**
 * Onde a cena começa, antes do primeiro ato.
 *
 * O palco anima a DIFERENÇA entre um ato e o anterior — é isso que faz o card
 * viajar entre as colunas em vez de aparecer já do outro lado. O ato 0 não tem
 * anterior, então recebe este: agenda limpa e o lead ainda na coluna "Novo".
 */
export const ESTADO_INICIAL = { slots: LIVRE, crmColumn: 0 } as const;

export const ACTS: Act[] = [
  {
    id: "chega",
    label: "Chega o lead",
    reason: "datetime_required",
    title: "O lead chega e pede para marcar.",
    body: "Pode vir de um anúncio, de um formulário ou do nada. O agente atende na hora, cria o contato no CRM e faz a única pergunta que falta: quando.",
    inbound: "Oi! Queria marcar um atendimento com vocês.",
    reply:
      "Não consegui identificar a data e o horário certinhos. Me diga o dia e a hora que você prefere (por exemplo: 20/07 às 14h) que eu verifico para você.",
    trace: ["Contato criado no CRM", "Intenção: marcar", "Falta a data e a hora"],
    slots: g({}),
    crmColumn: 1,
    crmMoved: true,
  },
  {
    id: "fora-da-janela",
    label: "Fora do horário",
    reason: "outside_availability",
    title: "Pede um horário em que você não atende.",
    body: "Você define os dias e a janela em que aceita agendamento. Fora disso o agente não marca — explica a janela real e pede outra hora.",
    inbound: "Pode ser domingo às 22h?",
    reply:
      "Esse horário fica fora da nossa janela de agendamento. Atendemos de segunda a sexta, das 09:00 às 18:00. Me diga outra data ou horário dentro desse período que eu confirmo para você.",
    trace: ["Janela do agente: seg a sex, 09:00–18:00", "Domingo 22:00 fora da janela", "Nada foi criado"],
    slots: g({}),
    crmColumn: 1,
  },
  {
    id: "passado",
    label: "Data que passou",
    reason: "past_datetime",
    title: "Pede um dia que já passou.",
    body: "Acontece o tempo todo — a pessoa se confunde com o mês. O agente compara com a data de hoje no fuso da sua operação e corrige sem constranger ninguém.",
    inbound: "Ah, então dia 12 de manhã.",
    reply: "Esse horário já passou. Me diga outro dia e horário que eu verifico para você.",
    trace: ["Data no fuso da operação", "12 já passou", "Nada foi criado"],
    slots: g({}),
    crmColumn: 1,
  },
  {
    id: "ocupado",
    label: "Horário ocupado",
    reason: "slot_taken",
    title: "Pede um horário que já está tomado.",
    body: "O agente confere a sua agenda de verdade antes de prometer. Se o horário caiu enquanto vocês conversavam, ele avisa na hora em vez de marcar por cima.",
    inbound: "Terça às 14h então.",
    reply:
      "Esse horário acabou de ficar indisponível na nossa agenda. Pode me indicar outra data ou horário? Eu verifico a disponibilidade e confirmo na hora.",
    trace: ["Terça 14:00 conferido", "Já ocupado", "Nada foi criado"],
    slots: g({ "Ter-14:00": "bloqueado" }),
    crmColumn: 1,
  },
  {
    id: "proposta",
    label: "Proposta",
    reason: "confirmation_required",
    title: "Encontra o horário e espera o sim.",
    body: "Aqui está o detalhe que separa o agente de um robô: ele propõe e para. Nada é gravado na agenda e o card não anda enquanto a pessoa não confirmar. A proposta expira sozinha se ela sumir.",
    inbound: "Quinta às 10h dá?",
    reply:
      "Quinta, dia 4, às 10:00 está livre. Confirmo esse horário para você?",
    trace: ["Quinta 10:00 disponível", "Proposta guardada, à espera do sim", "Agenda intacta · card parado"],
    slots: g({ "Qui-10:00": "proposto" }),
    crmColumn: 1,
  },
  {
    id: "confirmado",
    label: "Confirmado",
    reason: "schedule_confirmed",
    title: "O cliente confirma e tudo acontece de uma vez.",
    body: "Um “pode ser” dispara a cadeia inteira: o compromisso entra na agenda, o card muda de coluna, o lembrete fica agendado e você recebe o aviso no WhatsApp. Nenhuma dessas etapas precisa de alguém.",
    inbound: "Pode ser, confirma.",
    reply: "Pronto, seu agendamento foi confirmado.",
    trace: ["Compromisso criado", "Card movido para Agendado", "Lembretes agendados"],
    slots: g({ "Qui-10:00": "marcado" }),
    crmColumn: 2,
    crmMoved: true,
    effects: ["Lembrete agendado", "Você avisado no WhatsApp", "Google Agenda sincronizada"],
  },
  {
    id: "consulta",
    label: "Consulta",
    reason: "agenda_listed",
    title: "Depois pergunta que horas era mesmo.",
    body: "O agente lê a agenda e responde. Consultar não mexe em nada — nem no compromisso, nem no card.",
    inbound: "Me lembra que horas era mesmo?",
    reply: "Seu atendimento está marcado para quinta, dia 4, às 10:00.",
    trace: ["Agenda consultada", "Nenhuma alteração"],
    slots: g({ "Qui-10:00": "marcado" }),
    crmColumn: 2,
  },
  {
    id: "remarcado",
    label: "Remarcado",
    reason: "reschedule_confirmed",
    title: "Precisa mudar — e os lembretes mudam junto.",
    body: "O horário antigo é liberado, o novo é ocupado e os lembretes são reagendados para a data nova. O lembrete antigo não dispara: cada regra é versionada.",
    inbound: "Surgiu uma coisa, consigo passar para sexta às 16h?",
    reply: "Pronto, seu agendamento foi remarcado.",
    trace: ["Quinta 10:00 liberada", "Sexta 16:00 ocupada", "Lembretes antigos cancelados e refeitos"],
    slots: g({ "Sex-16:00": "marcado" }),
    crmColumn: 2,
    effects: ["Lembretes reagendados", "Você avisado da mudança"],
  },
  {
    id: "lembrete",
    label: "Lembrete",
    reason: "reminder",
    title: "O lembrete sai sozinho, na hora certa.",
    body: "Você define até três lembretes por compromisso — minutos, horas ou dias antes — com a mensagem que quiser. Ninguém aperta nada.",
    systemLine: "24 horas antes do atendimento",
    reply:
      "Oi Marina! Passando para lembrar do seu atendimento amanhã, sexta, às 16:00. Se precisar remarcar é só me falar por aqui.",
    trace: ["Regra: 1 dia antes", "Mensagem enviada", "Compromisso inalterado"],
    slots: g({ "Sex-16:00": "marcado" }),
    crmColumn: 2,
  },
  {
    id: "cancelado",
    label: "Cancelado",
    reason: "cancellation_confirmed",
    title: "Se cancelar, o horário volta a ficar livre.",
    body: "O compromisso sai da agenda, o horário fica disponível para outra pessoa e o card vai para a coluna que você escolheu para cancelamentos. Você é avisado.",
    inbound: "Infelizmente vou precisar cancelar.",
    reply: "Pronto, cancelei seu agendamento.",
    trace: ["Compromisso cancelado", "Sexta 16:00 liberada", "Card movido para Cancelado"],
    slots: g({}),
    crmColumn: 3,
    crmMoved: true,
    effects: ["Você avisado no WhatsApp", "Lembretes cancelados"],
  },
];
