import { describe, expect, it } from "vitest";
import {
  buildMetaFormKnownFactsPromptBlock,
  buildMetaInitialOutreachUserPrompt,
  collectKnownFormFieldRows,
  parseMetaLeadProfileMetadata,
} from "@/lib/meta-leads/form-metadata";

describe("meta-lead-form-metadata", () => {
  it("parses dynamic form fields and submissions", () => {
    const meta = parseMetaLeadProfileMetadata({
      source: "lead_ads",
      meta_form_name: "Form [04]",
      form_fields: [{ key: "renda", label: "Renda bruta", value: "R$ 8.000" }],
      meta_form_submissions: [
        {
          leadgen_id: "lg-1",
          form_name: "Form [02]",
          form_fields: [{ key: "interesse", label: "Interesse", value: "Apartamento" }],
          received_at: "2026-05-22T20:00:00.000Z",
        },
        {
          leadgen_id: "lg-2",
          form_name: "Form [04]",
          form_fields: [{ key: "renda", label: "Renda bruta", value: "R$ 9.000" }],
          received_at: "2026-05-22T21:00:00.000Z",
        },
      ],
    });
    const fields = collectKnownFormFieldRows(meta);
    expect(fields.some((f) => f.label === "Renda bruta" && f.value === "R$ 9.000")).toBe(true);
    expect(fields.some((f) => f.label === "Interesse")).toBe(true);
  });

  it("instructs agent not to re-ask filled form answers", () => {
    const block = buildMetaFormKnownFactsPromptBlock({
      source: "lead_ads",
      meta_form_name: "Formulário X",
      form_fields: [
        { key: "full_name", label: "Nome", value: "Renato" },
        { key: "renda", label: "Renda bruta", value: "R$ 5.000" },
      ],
    });
    expect(block).toContain("NUNCA pergunte de novo");
    expect(block).toContain("Renda bruta: R$ 5.000");
    expect(block).toContain("Nome: Renato");
  });

  it("includes form context in initial outreach user prompt", () => {
    const prompt = buildMetaInitialOutreachUserPrompt({
      leadName: "Renato",
      phone: "5562993580574",
      email: null,
      profileMetadata: {
        source: "lead_ads",
        meta_form_name: "Formulário X",
        form_fields: [{ key: "interesse", label: "Interesse", value: "Apartamento" }],
      },
    });
    expect(prompt).toContain("Formulário X");
    expect(prompt).toContain("Apartamento");
    expect(prompt).toContain("NUNCA pergunte");
  });
});
