import { describe, expect, it } from "vitest";
import { withoutTrailingDuplicateUserMessages } from "@/lib/ai/generate-agent-response";

describe("withoutTrailingDuplicateUserMessages", () => {
  it("removes trailing user message duplicated in canonical history", () => {
    const history = [
      { role: "user" as const, content: "Oi" },
      { role: "assistant" as const, content: "Olá" },
      { role: "user" as const, content: "Quero orçamento" },
    ];
    const tail = [{ role: "user" as const, content: "Quero orçamento" }];

    expect(withoutTrailingDuplicateUserMessages(history, tail)).toEqual([]);
  });

  it("keeps non-duplicate tail messages", () => {
    const history = [{ role: "user" as const, content: "Oi" }];
    const tail = [{ role: "user" as const, content: "Nova pergunta" }];

    expect(withoutTrailingDuplicateUserMessages(history, tail)).toEqual(tail);
  });

  it("keeps media tail message even when history has placeholder", () => {
    const history = [{ role: "user" as const, content: "[Áudio]" }];
    const tail = [{ role: "user" as const, content: "[Áudio transcrito]: preciso de ajuda" }];

    expect(withoutTrailingDuplicateUserMessages(history, tail)).toEqual(tail);
  });
});
