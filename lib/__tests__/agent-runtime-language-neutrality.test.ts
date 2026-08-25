import { describe, expect, it } from "vitest";
import { structuredAgendaSuccessText } from "@/lib/server/agent-cta-scheduler";
import {
  buildAgentLanguageInstruction,
  localizedAttachmentIntro,
  resolveTtsLanguageCode,
} from "@/lib/ai/language-detect";

describe("language-neutral deterministic runtime output", () => {
  it("localizes confirmed agenda facts for a supported BCP-47 language", () => {
    expect(
      structuredAgendaSuccessText(
        "scheduled",
        { type: "schedule", date: "20/09/2026", time: "14:00", location: "Room A" },
        "en-GB",
      ),
    ).toBe("All set, the appointment is confirmed for 20/09/2026 at 14:00, at Room A.");
  });

  it.each(["ja-JP", "ar-EG", "ko-KR"])(
    "uses language-free confirmed facts instead of forcing a language for %s",
    (languageTag) => {
      const text = structuredAgendaSuccessText(
        "rescheduled",
        { type: "schedule", date: "20/09/2026", time: "14:30", location: "A-7" },
        languageTag,
      );
      expect(text).toBe("✅ 🔄 📅 2026-09-20 · 🕒 14:30 · 📍 A-7");
      expect(text).not.toMatch(/pronto|agendado|appointment|confirmed/i);
    },
  );

  it("uses a language-free cancellation fact and attachment marker for unknown languages", () => {
    expect(structuredAgendaSuccessText("cancelled", { type: "cancel", eventId: null }, "hi-IN"))
      .toBe("✅ 🚫 📅");
    expect(localizedAttachmentIntro("zh-Hant")).toBe("📎");
    expect(localizedAttachmentIntro("es-419")).toBe("Aquí está el archivo solicitado.");
  });
});

/**
 * A plataforma atende qualquer país: um idioma que o MyChatCRM nunca previu
 * não pode ser rejeitado nem convertido à força para português. Estes casos
 * cobrem os idiomas listados no plano de blindagem e, principalmente, tags
 * BCP-47 que não estão em nenhuma tabela interna.
 */
describe("idioma configurado — qualquer BCP-47, sem fallback para português", () => {
  it.each([
    ["ru-RU", "russo"],
    ["ar-SA", "árabe"],
    ["ja-JP", "japonês"],
    ["zh-Hans", "chinês simplificado"],
    ["hi-IN", "hindi"],
    ["pt-BR", "português"],
    ["en-US", "inglês"],
    ["es-AR", "espanhol"],
  ])("aceita %s (%s) como idioma fixo e manda responder nele", (tag) => {
    const result = buildAgentLanguageInstruction(tag, "qualquer texto do cliente");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.languageTag).toBe(tag);
    expect(result.instruction).toContain(tag);
    // Nada de empurrar português quando o cliente escolheu outro idioma.
    if (!tag.startsWith("pt")) expect(result.instruction).not.toMatch(/portugu/i);
  });

  it.each(["sw-KE", "is-IS", "mt-MT", "qu-PE"])(
    "aceita %s mesmo sem estar em nenhuma tabela interna",
    (tag) => {
      const result = buildAgentLanguageInstruction(tag, "texto");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.languageTag).toBe(tag);
    },
  );

  it("modo automático segue a conversa e nunca assume um idioma quando o texto é inconclusivo", () => {
    const vazio = buildAgentLanguageInstruction("Automatico", "123 456");
    expect(vazio.ok).toBe(true);
    if (!vazio.ok) return;
    expect(vazio.languageTag).toBeNull();
    expect(vazio.instruction).toMatch(/do not default to any preselected language/i);
  });

  it("idioma configurado inválido falha visível, sem cair em português por baixo dos panos", () => {
    const result = buildAgentLanguageInstruction("idioma inventado!!", "texto");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("agent_invalid_language");
  });
});

describe("TTS segue o idioma da resposta final, não o do primeiro palpite", () => {
  it("usa o idioma do texto que realmente será falado", () => {
    expect(resolveTtsLanguageCode("Hola, gracias por escribir. ¿Cómo puedo ayudar hoy?")).toBe("es");
    expect(resolveTtsLanguageCode("Hello, how can I help you today?")).toBe("en");
    expect(resolveTtsLanguageCode("Olá, bom dia! Como posso ajudar você?")).toBe("pt");
  });

  it("omite a dica de idioma quando a resposta final está fora do conjunto do provedor", () => {
    // Sem dica, o modelo multilíngue infere do próprio texto — melhor do que
    // forçar um código errado e sair falando com sotaque de outro idioma.
    expect(resolveTtsLanguageCode("ご予約を承りました。")).toBeUndefined();
    expect(resolveTtsLanguageCode("Ваша встреча подтверждена.")).toBeUndefined();
  });
});
