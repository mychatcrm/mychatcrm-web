import "server-only";

import type { AiToolDefinition } from "@/lib/ai/types";

/**
 * Schemas das 5 tools de agenda para o OpenAI function calling.
 * Usadas em generateAgentResponse quando agendaAutomationEnabled = true.
 *
 * ATENÇÃO: tenant_id, remote_jid, attendee_phone e lead_id NÃO são parâmetros
 * do modelo — são sempre injetados pelo servidor (AgendaToolContext).
 */

const consultarAgendamentos: AiToolDefinition = {
  type: "function",
  function: {
    name: "consultar_agendamentos",
    description:
      "Lista os agendamentos futuros ativos do contato atual. " +
      "Use antes de criar ou remarcar para informar o cliente sobre compromissos existentes.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const verificarDisponibilidade: AiToolDefinition = {
  type: "function",
  function: {
    name: "verificar_disponibilidade",
    description:
      "Verifica se um horário está disponível considerando o horário comercial configurado " +
      "e conflitos com agendamentos existentes do tenant. " +
      "Retorna 'disponivel: true' ou o motivo do bloqueio. " +
      "Use ANTES de criar ou remarcar para confirmar com o cliente se o horário é válido.",
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "Data no formato DD/MM/AAAA (ex: 15/07/2026).",
        },
        hora: {
          type: "string",
          description: "Hora no formato HH:MM (ex: 14:30).",
        },
        duracao_min: {
          type: "string",
          description: "Duração em minutos (ex: '60'). Padrão: 60.",
        },
      },
      required: ["data", "hora"],
    },
  },
};

const criarAgendamento: AiToolDefinition = {
  type: "function",
  function: {
    name: "criar_agendamento",
    description:
      "Cria um agendamento para o contato atual após confirmação explícita de data e hora. " +
      "Valida horário comercial e conflito de horário antes de criar. " +
      "Use SOMENTE quando o cliente confirmou explicitamente a data e o horário desejados.",
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "Data no formato DD/MM/AAAA (ex: 15/07/2026).",
        },
        hora: {
          type: "string",
          description: "Hora no formato HH:MM (ex: 14:30).",
        },
        duracao_min: {
          type: "string",
          description: "Duração em minutos (ex: '60'). Padrão: 60.",
        },
        titulo: {
          type: "string",
          description: "Título do agendamento. Opcional — padrão: 'Agendamento via WhatsApp - {nome}'.",
        },
        local: {
          type: "string",
          description: "Local ou endereço do agendamento. Opcional.",
        },
      },
      required: ["data", "hora"],
    },
  },
};

const remarcarAgendamento: AiToolDefinition = {
  type: "function",
  function: {
    name: "remarcar_agendamento",
    description:
      "Remarca (troca a data/hora) de um agendamento existente. " +
      "OBRIGATÓRIO: antes de chamar esta tool, confirme com o cliente o agendamento específico " +
      "(data, hora, título) e aguarde confirmação explícita ('sim', 'pode', etc.). " +
      "Só passe confirmacao_do_cliente=true após o cliente confirmar. " +
      "Se confirmacao_do_cliente=false, a operação é rejeitada.",
    parameters: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description:
            "UUID do agendamento a remarcar. Obtenha do contexto de agenda listado no prompt " +
            "(campo event_id). Nunca invente ou adivinhe — use exatamente o valor do contexto.",
        },
        nova_data: {
          type: "string",
          description: "Nova data no formato DD/MM/AAAA.",
        },
        nova_hora: {
          type: "string",
          description: "Novo horário no formato HH:MM.",
        },
        duracao_min: {
          type: "string",
          description: "Duração em minutos. Padrão: 60.",
        },
        confirmacao_do_cliente: {
          type: "string",
          description:
            "Deve ser 'true' SOMENTE após o cliente confirmar explicitamente a remarcação. " +
            "Se ainda não confirmou, passe 'false' — a operação será bloqueada.",
          enum: ["true", "false"],
        },
      },
      required: ["event_id", "nova_data", "nova_hora", "confirmacao_do_cliente"],
    },
  },
};

const cancelarAgendamento: AiToolDefinition = {
  type: "function",
  function: {
    name: "cancelar_agendamento",
    description:
      "Cancela (soft-delete) um agendamento existente do contato atual. " +
      "OBRIGATÓRIO: antes de chamar esta tool, reafirme para o cliente o agendamento específico " +
      "(data, hora, título) e pergunte se confirma o cancelamento. " +
      "Aguarde um 'sim' explícito antes de passar confirmacao_do_cliente=true. " +
      "O follow-up automático é desbloqueado imediatamente após o cancelamento.",
    parameters: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description:
            "UUID do agendamento a cancelar. Obtenha do contexto de agenda listado no prompt " +
            "(campo event_id). Nunca invente ou adivinhe.",
        },
        confirmacao_do_cliente: {
          type: "string",
          description:
            "Deve ser 'true' SOMENTE após o cliente confirmar explicitamente o cancelamento. " +
            "Se ainda não confirmou, passe 'false' — a operação será bloqueada.",
          enum: ["true", "false"],
        },
      },
      required: ["event_id", "confirmacao_do_cliente"],
    },
  },
};

export const AGENDA_TOOL_DEFINITIONS: AiToolDefinition[] = [
  consultarAgendamentos,
  verificarDisponibilidade,
  criarAgendamento,
  remarcarAgendamento,
  cancelarAgendamento,
];

export const AGENDA_TOOL_NAMES = new Set(
  AGENDA_TOOL_DEFINITIONS.map((t) => t.function.name),
);
