import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from "@/lib/agents/default-system-prompt-template";

describe("default agent template", () => {
  it("is neutral and delegates niche, tone and objective to the manager", () => {
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("[SEGMENTO]");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("[OBJETIVO]");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("[TOM DE VOZ]");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).not.toContain("sou uma menina");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).not.toContain("persuasiva continuamente");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).not.toContain("vendas fechadas");
  });

  it("requires journey-safe context and avoids invented facts", () => {
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("contexto autorizado da conversa");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("outros contatos, campanhas ou agentes");
    expect(DEFAULT_SYSTEM_PROMPT_TEMPLATE).toContain("Não invente preços");
  });
});
