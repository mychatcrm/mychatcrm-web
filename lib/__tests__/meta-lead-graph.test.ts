import { describe, expect, it } from "vitest";
import {
  buildFormFieldsFromFieldData,
  buildLeadProfileMetadata,
  buildMetaInitialAgentPrompt,
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
      agentResolutionSource: "routing",
      questionLabels: new Map(),
    });
    expect(meta.meta_leadgen_id).toBe("lg-1");
    expect(meta.meta_form_id).toBe("form-1");
    expect(meta.meta_agent_resolution_source).toBe("routing");
    expect(Array.isArray(meta.form_fields)).toBe(true);
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
  });
});
