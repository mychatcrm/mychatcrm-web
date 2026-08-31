import { describe, expect, it } from "vitest";

import {
  formatCurrentDateTimeLine,
  normalizeIanaTimezone,
} from "@/lib/agents/agent-datetime";
import { buildAgentLanguageInstruction } from "@/lib/ai/language-detect";
import { isWithinBusinessHours } from "@/lib/server/follow-up-engine";

const SEED = 0x4d594348;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const zones = intl.supportedValuesOf?.("timeZone") ?? ["UTC"];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

const LANGUAGE_TAGS = [
  "pt-BR", "en-US", "es-AR", "fr-FR", "de-DE", "it-IT", "ar-SA",
  "ja-JP", "zh-Hans", "zh-Hant", "hi-IN", "ru-RU", "ko-KR", "sw-KE",
  "is-IS", "mt-MT", "qu-PE", "he-IL", "th-TH", "uk-UA", "tr-TR",
  "id-ID", "vi-VN", "fil-PH", "az-Latn-AZ", "sr-Cyrl-RS", "sr-Latn-RS",
] as const;

describe("certificação gerativa universal do runtime", () => {
  it("valida 10.000 combinações reproduzíveis de fuso, idioma, data e janela", () => {
    const random = seededRandom(SEED);
    const zones = supportedTimezones();

    for (let index = 0; index < 10_000; index += 1) {
      const timezone = zones[Math.floor(random() * zones.length)] ?? "UTC";
      const languageTag = LANGUAGE_TAGS[
        Math.floor(random() * LANGUAGE_TAGS.length)
      ] ?? "en-US";
      const timestamp = new Date(
        Date.UTC(
          2024 + Math.floor(random() * 8),
          Math.floor(random() * 12),
          1 + Math.floor(random() * 27),
          Math.floor(random() * 24),
          Math.floor(random() * 60),
        ),
      );
      const startHour = Math.floor(random() * 24);
      const endHour = Math.floor(random() * 24);

      expect(normalizeIanaTimezone(timezone)).toBe(timezone);
      const context = formatCurrentDateTimeLine(timezone, timestamp);
      expect(context).toContain(`(${timezone})`);
      expect(context).toMatch(/^Current date and time: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(.+\)$/);

      const language = buildAgentLanguageInstruction(languageTag, "neutral input");
      expect(language.ok).toBe(true);
      if (language.ok) {
        expect(language.languageTag).toBe(languageTag);
        if (!languageTag.startsWith("pt")) {
          expect(language.instruction).not.toMatch(/responda em portugu[eê]s/i);
        }
      }

      const within = isWithinBusinessHours(timestamp, {
        timezone,
        horaInicio: startHour,
        minutoInicio: index % 60,
        horaFim: endHour,
        minutoFim: (index * 7) % 60,
        diasAtivos: index % 3 === 0 ? [] : [0, 1, 2, 3, 4, 5, 6],
      });
      expect(typeof within).toBe("boolean");
    }
  }, 20_000);

  it("aceita todos os fusos IANA disponibilizados pelo runtime", () => {
    const zones = supportedTimezones();
    expect(zones.length).toBeGreaterThan(100);
    for (const timezone of zones) {
      expect(normalizeIanaTimezone(timezone)).toBe(timezone);
    }
  });
});
