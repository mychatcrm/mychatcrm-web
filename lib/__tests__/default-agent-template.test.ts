import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from "@/lib/agents/default-system-prompt-template";

describe("default agent template", () => {
  it("is neutral and delegates niche, tone and objective to the manager", () => {
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("[DESCREVA EXATAMENTE QUEM É O AGENTE");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("[DESCREVA O OBJETIVO DESTE AGENTE]");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("[INFORME UMA TAG BCP-47 FIXA OU AUTOMÁTICO");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).not.toContain("sou uma menina");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).not.toContain("persuasiva continuamente");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).not.toContain("vendas fechadas");
  });

  it("requires journey-safe context and avoids invented facts", () => {
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("dados autorizados e confirmados");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("outras conversas, jornadas, campanhas, agentes ou organizações");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("Quando faltar um fato necessário");
  });
});
