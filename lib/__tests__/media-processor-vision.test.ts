import { describe, expect, it } from "vitest";
import {
  formatVisualImageAnalysis,
  parseVisualImageAnalysis,
} from "@/lib/ai/media-processor";

describe("structured visual analysis", () => {
  it("preserves visible dates and marked elements without adding a niche", () => {
    const parsed = parseVisualImageAnalysis(JSON.stringify({
      summary: "Uma grade mensal com um dia circulado em vermelho.",
      visibleText: ["JULHO 2026", "23"],
      markedElements: ["O número 23 está circulado em vermelho"],
      dates: ["23/07/2026"],
      times: [],
      confidence: 0.96,
    }));

    expect(parsed).toMatchObject({ dates: ["23/07/2026"], confidence: 0.96 });
    const text = formatVisualImageAnalysis(parsed!);
    expect(JSON.parse(text)).toMatchObject({
      type: "visual_image_analysis",
      markedElements: ["O número 23 está circulado em vermelho"],
      dates: ["23/07/2026"],
      requiresCustomerConfirmation: false,
    });
    expect(text.toLowerCase()).not.toMatch(/imobili|cl[ií]nica|barbearia|corretor/);
  });

  it("marks low-confidence analysis so the agent asks instead of guessing", () => {
    const parsed = parseVisualImageAnalysis({
      summary: "Há duas datas parcialmente encobertas.",
      visibleText: [],
      markedElements: ["Marcação pouco nítida"],
      dates: ["12/08", "17/08"],
      times: [],
      confidence: 0.42,
    });
    expect(JSON.parse(formatVisualImageAnalysis(parsed!))).toMatchObject({
      requiresCustomerConfirmation: true,
      confidence: 0.42,
    });
  });

  it("accepts a fenced provider response and clamps confidence", () => {
    const parsed = parseVisualImageAnalysis(
      '```json\n{"summary":"Documento","visibleText":[],"markedElements":[],"dates":[],"times":[],"confidence":4}\n```',
    );
    expect(parsed?.confidence).toBe(1);
  });
});
