import { describe, expect, it } from "vitest";
import { detectSupportedLanguageCode } from "@/lib/ai/language-detect";

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

  it("defaults to Portuguese when there is no signal", () => {
    expect(detectSupportedLanguageCode("")).toBe("pt");
    expect(detectSupportedLanguageCode("12345")).toBe("pt");
  });
});
