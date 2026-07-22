import { describe, expect, it } from "vitest";
import { shouldSuppressLateInboundFragment } from "@/lib/conversas/late-inbound-fragment";

describe("late inbound fragment guard", () => {
  it.each([
    "Oi",
    "Book Tuesday at 2pm",
    "Quiero cancelar mi cita",
    "Tem algum agendamento meu ai?",
  ])(
    "suppresses any fragment authored before the committed response: %s",
    (content) => {
      expect(shouldSuppressLateInboundFragment({ isLateFragment: true, kind: "text", content })).toBe(true);
    },
  );

  it("also suppresses delayed media so it cannot create an isolated automatic turn", () => {
    expect(shouldSuppressLateInboundFragment({
      isLateFragment: true,
      kind: "audio",
      content: "[Audio]",
    })).toBe(true);
  });

  it("does not suppress a timely acknowledgement", () => {
    expect(shouldSuppressLateInboundFragment({ isLateFragment: false, kind: "text", content: "sim" })).toBe(false);
  });
});
