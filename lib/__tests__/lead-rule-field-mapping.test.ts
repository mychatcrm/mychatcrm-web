import { describe, expect, it } from "vitest";
import {
  applyLeadRuleMappingsToFields,
  buildLeadRuleMappingsFromFields,
  buildLeadRuleMappingsFromMetaFormGroups,
  computeFormMappingHealth,
  filterLeadRuleMappingsForForm,
  inferCrmFieldFromLeadFormField,
} from "@/lib/lead-rule-field-mapping";
import type { LeadFieldMapping } from "@/lib/lead-distribution-rules";

describe("lead rule field mapping", () => {
  it("maps standard Meta fields to CRM fields", () => {
    expect(inferCrmFieldFromLeadFormField({ key: "full_name", label: "Full name", type: "FULL_NAME" })).toBe("nome");
    expect(inferCrmFieldFromLeadFormField({ key: "phone_number", label: "Phone number", type: "PHONE" })).toBe("celular");
    expect(inferCrmFieldFromLeadFormField({ key: "email", label: "Email", type: "EMAIL" })).toBe("email");
  });

  it("maps contact preference questions to observations, not phone", () => {
    expect(
      inferCrmFieldFromLeadFormField({
        key: "como_voce_prefere_ser_contatado?",
        label: "Como você prefere ser contatado?",
        type: "CUSTOM",
      }),
    ).toBe("mensagem");
  });

  it("uses labels to map localized and custom contact fields", () => {
    expect(inferCrmFieldFromLeadFormField({ key: "custom_1", label: "Qual seu WhatsApp?", type: "CUSTOM" })).toBe(
      "celular",
    );
    expect(inferCrmFieldFromLeadFormField({ key: "custom_2", label: "Telefone para contato", type: "CUSTOM" })).toBe(
      "celular",
    );
    expect(inferCrmFieldFromLeadFormField({ key: "custom_3", label: "Nome da empresa", type: "CUSTOM" })).toBe(
      "empresa",
    );
  });

  it("keeps business questions as observations instead of overwriting core CRM fields", () => {
    expect(
      inferCrmFieldFromLeadFormField({
        key: "voce_atua_hoje_como_corretor_de_imoveis",
        label: "Você atua hoje como corretor de imóveis?",
        type: "CUSTOM",
      }),
    ).toBe("mensagem");
  });

  it("preserves manual mappings unless automatic remap is forced", () => {
    const existing: LeadFieldMapping[] = [
      {
        id: "manual-1",
        sourceKey: "phone_number",
        sourceLabel: "Phone number",
        kind: "form",
        crmField: "mensagem",
        formId: "form-a",
      },
    ];

    const kept = buildLeadRuleMappingsFromFields(
      [{ key: "phone_number", label: "Phone number", type: "PHONE" }],
      existing,
      { forceAuto: false, makeId: () => "new", formId: "form-a", formLabel: "Form A" },
    );
    expect(kept[0]?.crmField).toBe("mensagem");

    const remapped = buildLeadRuleMappingsFromFields(
      [{ key: "phone_number", label: "Phone number", type: "PHONE" }],
      existing,
      { forceAuto: true, makeId: () => "new", formId: "form-a", formLabel: "Form A" },
    );
    expect(remapped[0]?.crmField).toBe("celular");
  });

  it("builds separate mappings per Meta form with repeated source keys", () => {
    const mappings = buildLeadRuleMappingsFromMetaFormGroups(
      [
        {
          formId: "form-a",
          formLabel: "Campanha A",
          fields: [{ key: "custom_q", label: "Qual seu WhatsApp?", type: "CUSTOM" }],
        },
        {
          formId: "form-b",
          formLabel: "Campanha B",
          fields: [{ key: "custom_q", label: "Email profissional", type: "CUSTOM" }],
        },
      ],
      [],
      { forceAuto: true, makeId: () => "id" },
    );

    const formRows = mappings.filter((m) => m.kind === "form");
    expect(formRows).toHaveLength(2);
    expect(formRows.find((m) => m.formId === "form-a")?.crmField).toBe("celular");
    expect(formRows.find((m) => m.formId === "form-b")?.crmField).toBe("email");
  });

  it("filters mappings by incoming form id with legacy fallback", () => {
    const mappings: LeadFieldMapping[] = [
      { id: "1", sourceKey: "full_name", sourceLabel: "Nome", kind: "form", crmField: "nome", formId: "form-a" },
      { id: "2", sourceKey: "phone_number", sourceLabel: "Tel", kind: "form", crmField: "celular", formId: "form-b" },
      { id: "3", sourceKey: "form_name", sourceLabel: "Form", kind: "context", crmField: "mensagem" },
    ];

    const filtered = filterLeadRuleMappingsForForm(mappings, "form-b");
    expect(filtered.filter((m) => m.kind === "form").map((m) => m.sourceKey)).toEqual(["phone_number"]);
    expect(filtered.some((m) => m.kind === "context")).toBe(true);

    const legacy: LeadFieldMapping[] = [
      { id: "1", sourceKey: "full_name", sourceLabel: "Nome", kind: "form", crmField: "nome" },
      { id: "2", sourceKey: "phone_number", sourceLabel: "Tel", kind: "form", crmField: "celular" },
    ];
    const legacyFiltered = filterLeadRuleMappingsForForm(legacy, "any-form");
    expect(legacyFiltered).toHaveLength(2);
  });

  it("applies saved mappings to parsed Meta fields and normalizes phone", () => {
    const result = applyLeadRuleMappingsToFields(
      {
        full_name: "Renato Lagares",
        whatsapp: "(62) 99999-0000",
        email: "renato@example.com",
        empresa: "My Broker Office",
        voce_atua_hoje_como_corretor_de_imoveis: "Sim",
      },
      [
        { id: "1", sourceKey: "full_name", sourceLabel: "Full name", kind: "form", crmField: "nome", formId: "form-a" },
        { id: "2", sourceKey: "whatsapp", sourceLabel: "WhatsApp", kind: "form", crmField: "celular", formId: "form-a" },
        { id: "3", sourceKey: "email", sourceLabel: "Email", kind: "form", crmField: "email", formId: "form-b" },
        { id: "4", sourceKey: "empresa", sourceLabel: "Empresa", kind: "form", crmField: "empresa", formId: "form-a" },
        {
          id: "5",
          sourceKey: "voce_atua_hoje_como_corretor_de_imoveis",
          sourceLabel: "Você atua hoje como corretor de imóveis?",
          kind: "form",
          crmField: "mensagem",
          formId: "form-a",
        },
      ],
      { formId: "form-a" },
    );

    expect(result.name).toBe("Renato Lagares");
    expect(result.phone).toBe("5562999990000");
    expect(result.email).toBeNull();
    expect(result.company).toBe("My Broker Office");
    expect(result.observations).toEqual([
      {
        key: "voce_atua_hoje_como_corretor_de_imoveis",
        label: "Você atua hoje como corretor de imóveis?",
        value: "Sim",
      },
    ]);
  });

  it("computes health per form for wizard validation", () => {
    const health = computeFormMappingHealth(
      [
        { id: "1", sourceKey: "full_name", sourceLabel: "Nome", kind: "form", crmField: "nome", formId: "form-a" },
        { id: "2", sourceKey: "phone", sourceLabel: "Tel", kind: "form", crmField: "celular", formId: "form-a" },
        { id: "3", sourceKey: "email", sourceLabel: "Email", kind: "form", crmField: "email", formId: "form-b" },
      ],
      [
        { formId: "form-a", formLabel: "A" },
        { formId: "form-b", formLabel: "B" },
      ],
    );

    expect(health[0]?.canAdvance).toBe(true);
    expect(health[1]?.canAdvance).toBe(true);
    expect(health[1]?.hasCelular).toBe(false);
    expect(health[1]?.hasEmail).toBe(true);
  });
});
