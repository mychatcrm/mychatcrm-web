import { describe, expect, it } from "vitest";
import { rowToAgent } from "@/lib/server/tenant-agents-db";

const TENANT = "tenant-a";

describe("rowToAgent", () => {
  it("devolve o agente salvo pelo cliente, não o template de demonstração", () => {
    // Regressão: `ag-max-vendas` também é id de um template em memória. O editor
    // em página cheia lia o catálogo de templates e mostrava o agente demo;
    // salvar por ali sobrescrevia o agente real do cliente.
    const agent = rowToAgent(
      {
        agent_id: "ag-max-vendas",
        display_name: "Vendedor MCMV",
        system_prompt: "Prompt real do cliente.",
        active: true,
        updated_at: "2026-07-27T00:00:00.000Z",
        metadata: {
          nome: "Vendedor MCMV",
          systemPrompt: "Prompt real do cliente.",
          agendaAutomationEnabled: true,
          useSystemToneInstructions: false,
        },
      },
      TENANT,
    );

    expect(agent.nome).toBe("Vendedor MCMV");
    expect(agent.systemPrompt).toBe("Prompt real do cliente.");
    expect(agent.agendaAutomationEnabled).toBe(true);
    expect(agent.useSystemToneInstructions).toBe(false);
    expect(agent.clientId).toBe(TENANT);
    expect(agent.status).toBe("ativo");
  });

  it("marca como pausado quando a row está inativa", () => {
    const agent = rowToAgent(
      {
        agent_id: "ag-1",
        display_name: "Sofia",
        active: false,
        metadata: { nome: "Sofia", systemPrompt: "Atenda." },
      },
      TENANT,
    );

    expect(agent.status).toBe("pausado");
  });

  it("reconstrói a partir do template quando a row não tem metadata", () => {
    const agent = rowToAgent(
      {
        agent_id: "ag-legado",
        display_name: "Agente Legado",
        system_prompt: "Instruções gravadas na coluna.",
        active: true,
        metadata: null,
      },
      TENANT,
    );

    expect(agent.id).toBe("ag-legado");
    expect(agent.nome).toBe("Agente Legado");
    expect(agent.systemPrompt).toBe("Instruções gravadas na coluna.");
    expect(agent.clientId).toBe(TENANT);
  });

  it("prefere as colunas dedicadas de CRM quando existem na row", () => {
    const agent = rowToAgent(
      {
        agent_id: "ag-1",
        display_name: "Sofia",
        active: true,
        crm_auto_move_enabled: true,
        crm_target_funnel_id: "funil-default",
        crm_target_column_id: "contato",
        crm_target_status: "contato",
        metadata: { nome: "Sofia", systemPrompt: "Atenda.", crmAutoMoveEnabled: false },
      },
      TENANT,
    );

    expect(agent.crmAutoMoveEnabled).toBe(true);
    expect(agent.crmTargetFunnelId).toBe("funil-default");
  });
});
