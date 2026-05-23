import { describe, expect, it } from "vitest";
import {
  buildFormFieldsFromFieldData,
  buildLeadProfileMetadata,
  buildMetaInitialAgentPrompt,
  mergeLeadProfileMetadata,
} from "@/lib/server/meta-lead-graph";

describe("meta-lead-graph", () => {
  it("maps custom form fields with question labels", () => {
    const labels = new Map([["tipo_imovel", "Tipo de imóvel"]]);
    const fields = buildFormFieldsFromFieldData(
      [{ name: "tipo_imovel", values: ["Apartamento"] }, { name: "bairro", values: ["Bueno"] }],
      labels,
    );
    expect(fields).toEqual([
      { key: "tipo_imovel", label: "Tipo de imóvel", value: "Apartamento" },
      { key: "bairro", label: "Bairro", value: "Bueno" },
    ]);
  });

  it("builds profile metadata with leadgen and agent resolution", () => {
    const meta = buildLeadProfileMetadata({
      leadgenId: "lg-1",
      fieldData: [{ name: "full_name", values: ["Renato"] }],
      formId: "form-1",
      formName: "Form Teste",
      pageId: "page-1",
      pageName: "Página",
      campaignName: "Campanha A",
      adsetName: null,
      adName: "Anúncio 1",
      agentResolutionSource: "rule",
      questionLabels: new Map(),
    });
    expect(meta.meta_leadgen_id).toBe("lg-1");
    expect(meta.meta_form_id).toBe("form-1");
    expect(meta.meta_agent_resolution_source).toBe("rule");
    expect(Array.isArray(meta.form_fields)).toBe(true);
  });

  it("appends each leadgen to meta_form_submissions without dropping prior forms", () => {
    const first = buildLeadProfileMetadata({
      leadgenId: "lg-1",
      fieldData: [{ name: "interesse", values: ["A"] }],
      formId: "form-a",
      formName: "Form A",
      pageId: "p1",
      pageName: null,
      campaignName: null,
      adsetName: null,
      adName: null,
      questionLabels: new Map(),
    });
    const second = buildLeadProfileMetadata({
      leadgenId: "lg-2",
      fieldData: [{ name: "interesse", values: ["B"] }],
      formId: "form-b",
      formName: "Form B",
      pageId: "p1",
      pageName: null,
      campaignName: null,
      adsetName: null,
      adName: null,
      questionLabels: new Map(),
    });
    const merged = mergeLeadProfileMetadata(first, second);
    const history = merged.meta_form_submissions as Array<{ leadgen_id: string; form_name?: string }>;
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.leadgen_id)).toEqual(["lg-1", "lg-2"]);
    expect(merged.meta_form_name).toBe("Form B");
  });

  it("includes form answers in the initial AI prompt", () => {
    const prompt = buildMetaInitialAgentPrompt({
      leadName: "Renato",
      phone: "5562993580574",
      email: null,
      formName: "Formulário X",
      pageName: null,
      campaignName: null,
      adName: null,
      formFields: [{ key: "interesse", label: "Interesse", value: "Apartamento no Bueno até 500 mil" }],
    });
    expect(prompt).toContain("Renato");
    expect(prompt).toContain("Formulário X");
    expect(prompt).toContain("Apartamento no Bueno");
    expect(prompt).toContain("NUNCA pergunte");
  });
});
