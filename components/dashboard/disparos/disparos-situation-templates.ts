import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Cake,
  CalendarCheck,
  Flame,
  Handshake,
  HeartPulse,
  PartyPopper,
  Snowflake,
} from "lucide-react";

export type SituationTemplate = {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  Icon: LucideIcon;
  /** Tailwind text color class for icon accent */
  accent: string;
};

/** Modelos de copy para campanhas em massa — ajuste conforme o tom da marca do cliente. */
export const SITUATION_TEMPLATES: SituationTemplate[] = [
  {
    id: "welcome",
    title: "Boas-vindas",
    subtitle: "Lead novo ou primeiro contato",
    Icon: Handshake,
    accent: "text-sky-400",
    body: "Ola {{nome}}! Aqui e a equipe da {{empresa}}. Recebemos seu interesse e ja separamos um atendente para te ajudar. Posso te enviar um resumo em 1 minuto?",
  },
  {
    id: "reactivate",
    title: "Reativacao",
    subtitle: "Base fria ou sem resposta",
    Icon: Snowflake,
    accent: "text-cyan-400",
    body: "Oi {{nome}}, faz tempo que a gente nao conversa por aqui. Tenho uma novidade que pode valer para {{empresa}}. Se quiser retomar, responda EU QUERO e te mando os detalhes.",
  },
  {
    id: "promo",
    title: "Oferta limitada",
    subtitle: "Campanha com urgencia leve",
    Icon: Flame,
    accent: "text-orange-400",
    body: "{{nome}}, liberamos uma condicao especial para {{empresa}} ate o fim da semana. Para receber o link com valores, responda SIM. Sem spam: se nao for o momento, responda DEPOIS.",
  },
  {
    id: "appointment",
    title: "Consulta / reuniao",
    subtitle: "Lembrete e confirmacao",
    Icon: CalendarCheck,
    accent: "text-emerald-400",
    body: "Ola {{nome}}, passando para confirmar nosso horario com {{empresa}}. Responda OK para confirmar ou REAGENDAR se precisar mudar. Seu contato: {{telefone}}.",
  },
  {
    id: "post-sale",
    title: "Pos-venda",
    subtitle: "Onboarding e satisfacao",
    Icon: HeartPulse,
    accent: "text-rose-400",
    body: "Oi {{nome}}! Tudo certo com sua experiencia na {{empresa}}? Se precisar de suporte, estamos no {{telefone}}. Se estiver tudo ok, um feedback rapido nos ajuda muito — responda TUDO OK ou PRECISO DE AJUDA.",
  },
  {
    id: "event",
    title: "Convite / evento",
    subtitle: "Webinar, loja ou lancamento",
    Icon: PartyPopper,
    accent: "text-violet-400",
    body: "{{nome}}, voce esta convidado(a) a participar de um momento exclusivo com a {{empresa}}. Responda PARTICIPAR que envio data, horario e link. Se nao puder agora, responda FICA PARA PROXIMA.",
  },
  {
    id: "birthday",
    title: "Data especial",
    subtitle: "Aniversario ou marco do cliente",
    Icon: Cake,
    accent: "text-amber-400",
    body: "Feliz dia especial, {{nome}}! A {{empresa}} preparou um mimo simbolico para voce. Responda RESGATAR que te envio o cupom ou instrucoes. Aproveite!",
  },
  {
    id: "handoff",
    title: "Handoff humano",
    subtitle: "Apos o bot ou fila",
    Icon: Bot,
    accent: "text-primary",
    body: "Ola {{nome}}, aqui ja e um atendente humano da {{empresa}}. Vi sua conversa anterior e posso seguir com voce agora. Em que posso ajudar?",
  },
];
