import { describe, expect, it } from "vitest";
import {
  applyLeadRuleMappingsToFields,
  buildLeadRuleMappingsFromFields,
  inferCrmFieldFromLeadFormField,
} from "@/lib/lead-rule-field-mapping";
import type { LeadFieldMapping } from "@/lib/lead-distribution-rules";

describe("lead rule field mapping", () => {
  it("maps standard Meta fields to CRM fields", () => {
    expect(inferCrmFieldFromLeadFormField({ key: "full_name", label: "Full name", type: "FULL_NAME" })).toBe("nome");
    expect(inferCrmFieldFromLeadFormField({ key: "phone_number", label: "Phone number", type: "PHONE" })).toBe("celular");
    expect(inferCrmFieldFromLeadFormField({ key: "email", label: "Email", type: "EMAIL" })).toBe("email");
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
      },
    ];

    const kept = buildLeadRuleMappingsFromFields(
      [{ key: "phone_number", label: "Phone number", type: "PHONE" }],
      existing,
      { forceAuto: false, makeId: () => "new" },
    );
    expect(kept[0]?.crmField).toBe("mensagem");

    const remapped = buildLeadRuleMappingsFromFields(
      [{ key: "phone_number", label: "Phone number", type: "PHONE" }],
      existing,
      { forceAuto: true, makeId: () => "new" },
    );
    expect(remapped[0]?.crmField).toBe("celular");
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
        { id: "1", sourceKey: "full_name", sourceLabel: "Full name", kind: "form", crmField: "nome" },
        { id: "2", sourceKey: "whatsapp", sourceLabel: "WhatsApp", kind: "form", crmField: "celular" },
        { id: "3", sourceKey: "email", sourceLabel: "Email", kind: "form", crmField: "email" },
        { id: "4", sourceKey: "empresa", sourceLabel: "Empresa", kind: "form", crmField: "empresa" },
        {
          id: "5",
          sourceKey: "voce_atua_hoje_como_corretor_de_imoveis",
          sourceLabel: "Você atua hoje como corretor de imóveis?",
          kind: "form",
          crmField: "mensagem",
        },
      ],
    );

    expect(result.name).toBe("Renato Lagares");
    expect(result.phone).toBe("5562999990000");
    expect(result.email).toBe("renato@example.com");
    expect(result.company).toBe("My Broker Office");
    expect(result.observations).toEqual([
      {
        key: "voce_atua_hoje_como_corretor_de_imoveis",
        label: "Você atua hoje como corretor de imóveis?",
        value: "Sim",
      },
    ]);
  });
});
