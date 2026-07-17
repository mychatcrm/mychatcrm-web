import { describe, expect, it } from "vitest";
import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";

describe("late inbound fragment guard", () => {
  it.each(["Oi", "oide", "ok", "pode", "pode ser?", "sim", "até mais"]) (
    "suppresses a context-free delayed fragment: %s",
    (content) => {
      expect(shouldSuppressLateInboundFragment({ isLateFragment: true, kind: "text", content })).toBe(true);
    },
  );

  it("suppresses a repeated delayed agenda read", () => {
    expect(shouldSuppressLateInboundFragment({
      isLateFragment: true,
      kind: "text",
      content: "pode olhar se tem algum agendamento meu?",
    })).toBe(true);
  });

  it.each([
    "quero cancelar meu agendamento",
    "quero remarcar para amanhã às 10h",
    "agende para sexta às 14h",
    "Tenho uma dúvida diferente",
  ])("never suppresses a substantive new command: %s", (content) => {
    expect(shouldSuppressLateInboundFragment({ isLateFragment: true, kind: "text", content })).toBe(false);
  });

  it("does not suppress a timely acknowledgement", () => {
    expect(shouldSuppressLateInboundFragment({ isLateFragment: false, kind: "text", content: "sim" })).toBe(false);
  });
});
