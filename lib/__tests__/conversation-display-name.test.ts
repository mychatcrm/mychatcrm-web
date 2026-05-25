import { describe, expect, it } from "vitest";
import {
  resolveConversationDisplayName,
  shouldFetchEvolutionContactName,
} from "@/lib/conversas/display-name";

describe("resolveConversationDisplayName", () => {
  it("prioriza lead.name sobre pushName e telefone", () => {
    expect(
      resolveConversationDisplayName({
        leadName: "Maria Silva",
        pushName: "Mari",
        phoneLabel: "+55 62 99999-0000",
      }),
    ).toBe("Maria Silva");
  });

  it("usa pushName quando não há lead", () => {
    expect(
      resolveConversationDisplayName({
        leadName: null,
        pushName: "João WA",
        phoneLabel: "+5562993580574",
      }),
    ).toBe("João WA");
  });

  it("cai no telefone quando não há nome", () => {
    expect(
      resolveConversationDisplayName({
        leadName: "  ",
        pushName: "",
        phoneLabel: "+5562993580574",
      }),
    ).toBe("+5562993580574");
  });
});

describe("shouldFetchEvolutionContactName", () => {
  it("não busca Evolution quando lead já tem nome", () => {
    expect(shouldFetchEvolutionContactName({ leadName: "CRM Lead" })).toBe(false);
  });

  it("busca Evolution sem nome de lead", () => {
    expect(shouldFetchEvolutionContactName({ leadName: null })).toBe(true);
  });
});
