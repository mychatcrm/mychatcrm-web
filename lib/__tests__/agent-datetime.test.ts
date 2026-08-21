import { describe, expect, it } from "vitest";
import { formatSystemDateTimeContextBlock, parseTimezone, resolveAgentTimezone } from "@/lib/agents/agent-datetime";

describe("formatSystemDateTimeContextBlock", () => {
  it("uses the exact system context bracket format", () => {
    const block = formatSystemDateTimeContextBlock(
      "America/Sao_Paulo",
      new Date("2026-05-28T15:30:00.000Z"),
    );
    expect(block).toMatch(
      /^\[CONTEXTO DO SISTEMA: Data e hora atual: .+, \d{2} de .+ de \d{4}, \d{2}:\d{2} \(America\/Sao_Paulo\)\. Use SEMPRE esta data\/hora como referência para qualquer cálculo de data/,
    );
  });
});

describe("parseTimezone", () => {
  it("respeita UTC quando escolhido explicitamente — a troca continua livre", () => {
    expect(parseTimezone("UTC")).toBe("UTC");
  });

  it("aceita qualquer fuso IANA válido escolhido pelo cliente", () => {
    expect(parseTimezone("America/New_York")).toBe("America/New_York");
    expect(parseTimezone("Europe/Lisbon")).toBe("Europe/Lisbon");
  });

  it("sem valor salvo, cai em América/São Paulo — não em UTC", () => {
    // Plataforma pt-BR: um agente sem fuso configurado não pode ter a janela
    // comercial do follow-up adiantada em 3h por causa de um default genérico.
    expect(parseTimezone(undefined)).toBe("America/Sao_Paulo");
    expect(parseTimezone(null)).toBe("America/Sao_Paulo");
    expect(parseTimezone("")).toBe("America/Sao_Paulo");
  });

  it("valor ilegível (não é fuso IANA) também cai em América/São Paulo", () => {
    expect(parseTimezone("não é um fuso")).toBe("America/Sao_Paulo");
    expect(parseTimezone(42)).toBe("America/Sao_Paulo");
  });
});

describe("resolveAgentTimezone", () => {
  it("usa o fuso salvo na raiz do agente quando presente", () => {
    expect(resolveAgentTimezone({ timezone: "America/Manaus" })).toBe("America/Manaus");
  });

  it("sem fuso na raiz, cai pro fuso do followUpInteligente", () => {
    expect(
      resolveAgentTimezone({ followUpInteligente: { timezone: "Europe/Lisbon" } as never }),
    ).toBe("Europe/Lisbon");
  });

  it("agente totalmente sem fuso configurado resolve pra América/São Paulo", () => {
    expect(resolveAgentTimezone({})).toBe("America/Sao_Paulo");
  });
});
