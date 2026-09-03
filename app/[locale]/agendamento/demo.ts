/**
 * O guião da demonstração ao vivo do hero.
 *
 * Uma conversa SÓ, que vai crescendo no ecrã — não dez cenas que reiniciam.
 * Foi esse o erro das versões anteriores: cada situação limpava o palco, e o
 * visitante nunca via uma história inteira acontecer. Aqui as mensagens
 * acumulam como num WhatsApp de verdade, e a agenda e o CRM reagem à medida
 * que o agente decide.
 *
 * O arco fecha num ganho: chega o lead, o agente recusa um horário impossível
 * (é o que mostra cuidado), encontra o certo, confirma, e o lembrete sai
 * sozinho. Cerca de 18 segundos do primeiro "oi" ao lembrete.
 *
 * As falas do agente são o texto REAL do motor
 * (`lib/server/agent-cta-scheduler.ts`), encurtadas apenas onde o texto
 * completo não caberia na bolha do hero — a versão integral de cada uma está
 * na grelha das dez situações, mais abaixo na página.
 */

export type EstadoSlot = "livre" | "ocupado" | "proposto" | "marcado";

export type Batida = {
  /** Milissegundos desde o início do ciclo. */
  t: number;
  quem: "lead" | "agente" | "sistema";
  texto: string;
  /** O que muda na agenda quando esta fala acaba de ser escrita. */
  agenda?: Record<string, EstadoSlot>;
  /** Coluna do card no CRM (índice em COLUNAS_CRM). */
  crm?: number;
  /** Chips que acendem depois desta fala. */
  efeitos?: string[];
};

export const COLUNAS_CRM = ["Novo", "Em conversa", "Agendado"] as const;
export const DIAS = ["Ter", "Qua", "Qui", "Sex"] as const;
export const HORAS = ["10:00", "14:00", "16:00"] as const;

/** Agenda no início do ciclo: dois horários já tomados por outras pessoas. */
export const AGENDA_INICIAL: Record<string, EstadoSlot> = {
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

/** Velocidade da escrita do agente, em ms por carácter. */
export const MS_POR_CHAR = 12;
/** Quanto tempo os três pontinhos aparecem antes de a fala começar a sair. */
export const MS_A_ESCREVER = 720;
/** Respiro no fim, antes de o ciclo voltar ao início. */
export const MS_FINAL = 2400;

export const GUIAO: Batida[] = [
  {
    t: 300,
    quem: "lead",
    texto: "Oi! Queria marcar um atendimento com vocês.",
    crm: 0,
  },
  {
    t: 1500,
    quem: "agente",
    texto: "Me diga o dia e a hora que você prefere (por exemplo: 20/07 às 14h) que eu verifico para você.",
    crm: 1,
  },
  {
    t: 4400,
    quem: "lead",
    texto: "Pode ser domingo às 22h?",
  },
  {
    t: 5600,
    quem: "agente",
    texto: "Esse horário fica fora da nossa janela. Atendemos de segunda a sexta, das 09:00 às 18:00.",
  },
  {
    t: 8300,
    quem: "lead",
    texto: "Ah tá. Quinta às 10h dá?",
  },
  {
    t: 9500,
    quem: "agente",
    texto: "Quinta, dia 4, às 10:00 está livre. Confirmo esse horário para você?",
    agenda: { "Qui-10:00": "proposto" },
  },
  {
    t: 11600,
    quem: "lead",
    texto: "Pode ser, confirma.",
  },
  {
    t: 12700,
    quem: "agente",
    texto: "Pronto, seu agendamento foi confirmado.",
    agenda: { "Qui-10:00": "marcado" },
    crm: 2,
    efeitos: ["Na agenda", "Card movido", "Lembrete marcado", "Você avisado"],
  },
  {
    t: 14900,
    quem: "sistema",
    texto: "24 horas antes — ninguém apertou nada",
  },
  {
    t: 15500,
    quem: "agente",
    texto: "Oi Marina! Passando para lembrar do seu atendimento amanhã às 10:00.",
  },
];

/** Quando a última fala acaba de ser escrita. */
export function fimDoGuiao(): number {
  const ultima = GUIAO[GUIAO.length - 1]!;
  return ultima.t + ultima.texto.length * MS_POR_CHAR;
}

/** Duração de um ciclo completo, com o respiro do fim. */
export const CICLO_MS = fimDoGuiao() + MS_FINAL;
