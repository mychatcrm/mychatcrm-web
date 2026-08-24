import { describe, expect, it } from "vitest";
import {
  buildAgentLanguageInstruction,
  detectConversationLanguageTag,
  detectSupportedLanguageCode,
  resolveConfiguredConversationLanguage,
  resolveTtsLanguageCode,
  supportedLanguageCodeFromTag,
} from "@/lib/ai/language-detect";

describe("detectSupportedLanguageCode", () => {
  it("detects Portuguese", () => {
    expect(detectSupportedLanguageCode("Olá, preciso de ajuda com meu atendimento hoje")).toBe("pt");
  });

  it("detects English", () => {
    expect(detectSupportedLanguageCode("Hello, I need help with my account today")).toBe("en");
  });

  it("detects Spanish", () => {
    expect(detectSupportedLanguageCode("Hola, necesito ayuda con mi cuenta")).toBe("es");
  });

  it("detects French", () => {
    expect(detectSupportedLanguageCode("Bonjour, j'ai besoin de votre aide aujourd'hui")).toBe("fr");
  });

  it("detects German", () => {
    expect(detectSupportedLanguageCode("Hallo, ich brauche bitte Hilfe heute")).toBe("de");
  });

  it("detects Italian", () => {
    expect(detectSupportedLanguageCode("Ciao, ho bisogno di aiuto oggi")).toBe("it");
  });

  it("does not force Portuguese when there is no supported signal", () => {
    expect(detectSupportedLanguageCode("")).toBe("en");
    expect(detectSupportedLanguageCode("12345")).toBe("en");
    expect(detectSupportedLanguageCode("こんにちは")).toBe("en");
  });
});

describe("universal conversation language", () => {
  it.each([
    ["مرحبا، أحتاج إلى المساعدة", "ar"],
    ["こんにちは、手伝ってください", "ja"],
    ["你好，我需要帮助", "zh"],
    ["नमस्ते, मुझे मदद चाहिए", "hi"],
    ["Здравствуйте, мне нужна помощь", "ru"],
  ])("detects scripts without forcing Portuguese: %s", (text, expected) => {
    expect(detectConversationLanguageTag(text)).toBe(expected);
  });

  it("does not choose a language when automatic text is inconclusive", () => {
    expect(detectConversationLanguageTag("12345")).toBeNull();
    expect(buildAgentLanguageInstruction("Automático", "12345")).toMatchObject({
      ok: true,
      languageTag: null,
    });
  });

  it.each(["en-GB", "ar-EG", "zh-Hant", "pt-BR", "es-419"])(
    "accepts any valid BCP-47 fixed tag: %s",
    (tag) => {
      expect(resolveConfiguredConversationLanguage(tag, "ignored")).toMatchObject({
        ok: true,
        mode: "fixed",
      });
    },
  );

  it("fails visibly for an invalid fixed language instead of falling back", () => {
    expect(resolveConfiguredConversationLanguage("not a language!", "Olá")).toEqual({
      ok: false,
      mode: "invalid",
      value: "not a language!",
    });
  });

  it("derives the ElevenLabs hint from the final reply only", () => {
    expect(resolveTtsLanguageCode("Hello, I can help you today.")).toBe("en");
    expect(resolveTtsLanguageCode("こんにちは。お手伝いします。")).toBeUndefined();
  });

  it("does not coerce arbitrary BCP-47 tags into an internal English or Portuguese copy", () => {
    expect(supportedLanguageCodeFromTag("en-GB")).toBe("en");
    expect(supportedLanguageCodeFromTag("pt-BR")).toBe("pt");
    expect(supportedLanguageCodeFromTag("ja-JP")).toBeNull();
    expect(supportedLanguageCodeFromTag("ar-EG")).toBeNull();
  });
});
