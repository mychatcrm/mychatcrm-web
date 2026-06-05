import { describe, expect, it } from "vitest";
import { formatSystemDateTimeContextBlock } from "@/lib/agents/agent-datetime";

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
