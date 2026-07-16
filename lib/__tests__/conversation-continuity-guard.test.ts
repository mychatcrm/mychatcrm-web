import { describe, expect, it } from "vitest";
import { preserveActiveConversationContinuity } from "@/lib/conversas/conversation-continuity-guard";

describe("preserveActiveConversationContinuity", () => {
  it("remove nova saudação e retomada artificial em conversa ativa", () => {
    expect(
      preserveActiveConversationContinuity({
        clientText: "Oi",
        activeConversation: true,
        reply:
          "Oi, Renato! Como você está? Vamos continuar nossa conversa sobre o atendimento. Você tem disponibilidade hoje?",
      }),
    ).toBe("Você tem disponibilidade hoje?");
  });

  it("não altera saudação no primeiro contato", () => {
    const reply = "Oi, Renato! Como posso ajudar?";
    expect(
      preserveActiveConversationContinuity({ clientText: "Oi", activeConversation: false, reply }),
    ).toBe(reply);
  });

  it("não interfere em mensagem substantiva do cliente", () => {
    const reply = "Oi, Renato! Amanhã às 14h funciona para você?";
    expect(
      preserveActiveConversationContinuity({
        clientText: "Oi, quero agendar amanhã",
        activeConversation: true,
        reply,
      }),
    ).toBe(reply);
  });
});
