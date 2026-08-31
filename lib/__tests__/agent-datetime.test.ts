import { describe, expect, it } from "vitest";
import {
  formatCurrentDateTimeLine,
  formatSystemDateTimeContextBlock,
  isValidIanaTimezone,
  normalizeIanaTimezone,
  parseTimezone,
  resolveAgentTimezone,
  resolveExplicitAgentTimezone,
} from "@/lib/agents/agent-datetime";

describe("formatSystemDateTimeContextBlock", () => {
  it("uses the exact system context bracket format", () => {
    const block = formatSystemDateTimeContextBlock(
      "America/Sao_Paulo",
      new Date("2026-05-28T15:30:00.000Z"),
    );
    expect(block).toBe(
      "[SYSTEM CONTEXT: Current date and time: 2026-05-28 12:30 (America/Sao_Paulo). Use this timestamp only as the temporal reference for date calculations.]",
    );
    expect(block).not.toMatch(/CONTEXTO|Data e hora|amanhã|agendamento/i);
  });
});

describe("parseTimezone", () => {
  it("normalizes whitespace but never coerces non-string values", () => {
    expect(normalizeIanaTimezone("  Europe/Lisbon  ")).toBe("Europe/Lisbon");
    expect(normalizeIanaTimezone("   ")).toBeNull();
    expect(normalizeIanaTimezone({ toString: () => "UTC" })).toBeNull();
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it("respeita UTC quando escolhido explicitamente — a troca continua livre", () => {
    expect(parseTimezone("UTC")).toBe("UTC");
  });

  it("aceita qualquer fuso IANA válido escolhido pelo cliente", () => {
    expect(parseTimezone("America/New_York")).toBe("America/New_York");
    expect(parseTimezone("Europe/Lisbon")).toBe("Europe/Lisbon");
  });

  it("uses only the country-neutral computational fallback outside timed actions", () => {
    expect(parseTimezone(undefined)).toBe("UTC");
    expect(parseTimezone(null)).toBe("UTC");
    expect(parseTimezone("")).toBe("UTC");
  });

  it("does not infer a country from an invalid value", () => {
    expect(parseTimezone("not a timezone")).toBe("UTC");
    expect(parseTimezone(42)).toBe("UTC");
    expect(isValidIanaTimezone("not a timezone")).toBe(false);
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

  it("ignora raiz vazia e normaliza a escolha explícita", () => {
    expect(resolveExplicitAgentTimezone({
      timezone: "   ",
      followUpInteligente: { timezone: "  Asia/Tokyo  " } as never,
    })).toBe("Asia/Tokyo");
    expect(resolveExplicitAgentTimezone({
      timezone: "  Europe/Paris  ",
      followUpInteligente: { timezone: "Asia/Tokyo" } as never,
    })).toBe("Europe/Paris");
  });

  it("does not treat the neutral fallback as an explicit operator choice", () => {
    expect(resolveAgentTimezone({})).toBe("UTC");
    expect(resolveExplicitAgentTimezone({})).toBeNull();
    expect(resolveExplicitAgentTimezone({ timezone: "invalid" })).toBeNull();
  });
});

describe("formatCurrentDateTimeLine", () => {
  it("renders exact civil fields and explicit timezone", () => {
    expect(formatCurrentDateTimeLine(
      "Asia/Tokyo",
      new Date("2026-08-30T15:04:00.000Z"),
    )).toBe("Current date and time: 2026-08-31 00:04 (Asia/Tokyo)");
  });
});
