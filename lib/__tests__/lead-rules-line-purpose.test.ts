import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupWhatsAppCloudConnectionByPhoneNumberIdMock, getSlotPurposeMock } = vi.hoisted(() => ({
  lookupWhatsAppCloudConnectionByPhoneNumberIdMock: vi.fn(),
  getSlotPurposeMock: vi.fn(),
}));

vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  lookupWhatsAppCloudConnectionByPhoneNumberId: lookupWhatsAppCloudConnectionByPhoneNumberIdMock,
}));
vi.mock("@/lib/server/whatsapp-slot-provider", () => ({ getSlotPurpose: getSlotPurposeMock }));

import { purposeForRuleSource, validateRuleLinePurpose } from "@/lib/server/lead-rules-line-purpose";

/** Instância Evolution do tenant, sempre no slot informado. */
function makeSb(evoRow: { slot_index: number } | null) {
  return {
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue({ data: evoRow, error: null }),
      };
      return query;
    }),
  } as never;
}

const evolutionRule = (source: string) => ({
  source,
  connection_id: "evo-uuid-1",
  transport: "evolution",
});

beforeEach(() => {
  vi.clearAllMocks();
  getSlotPurposeMock.mockResolvedValue(null);
});

describe("purposeForRuleSource", () => {
  it("mapeia origem de regra para a finalidade exigida", () => {
    expect(purposeForRuleSource("meta_form")).toBe("forms");
    expect(purposeForRuleSource("whatsapp_organico")).toBe("direct");
  });

  it("origens sem finalidade própria não exigem nada", () => {
    expect(purposeForRuleSource("whatsapp_api")).toBeNull();
    expect(purposeForRuleSource("other")).toBeNull();
    expect(purposeForRuleSource(undefined)).toBeNull();
  });
});

describe("validateRuleLinePurpose", () => {
  // Esta é a garantia de zero regressão: todo tenant já configurado tem as
  // linhas sem finalidade, e continua salvando regra como sempre salvou.
  it("libera qualquer regra numa linha livre (purpose null)", async () => {
    const sb = makeSb({ slot_index: 0 });
    getSlotPurposeMock.mockResolvedValue(null);

    expect(await validateRuleLinePurpose(sb, "t1", evolutionRule("meta_form"))).toBeNull();
    expect(await validateRuleLinePurpose(sb, "t1", evolutionRule("whatsapp_organico"))).toBeNull();
  });

  it("libera quando a finalidade da linha bate com a origem da regra", async () => {
    const sb = makeSb({ slot_index: 0 });

    getSlotPurposeMock.mockResolvedValue("forms");
    expect(await validateRuleLinePurpose(sb, "t1", evolutionRule("meta_form"))).toBeNull();

    getSlotPurposeMock.mockResolvedValue("direct");
    expect(await validateRuleLinePurpose(sb, "t1", evolutionRule("whatsapp_organico"))).toBeNull();
  });

  it("recusa regra de WhatsApp direto numa linha de formulários", async () => {
    const sb = makeSb({ slot_index: 0 });
    getSlotPurposeMock.mockResolvedValue("forms");

    const response = await validateRuleLinePurpose(sb, "t1", evolutionRule("whatsapp_organico"));

    expect(response?.status).toBe(409);
    const body = await response!.json();
    expect(body.code).toBe("line_purpose_mismatch");
    expect(body.error).toContain("Linha 1");
    expect(body.error).toContain("Formulários Meta");
    expect(body.error).toContain("WhatsApp direto");
  });

  it("recusa regra de formulário numa linha de WhatsApp direto, nomeando a linha certa", async () => {
    const sb = makeSb({ slot_index: 1 });
    getSlotPurposeMock.mockResolvedValue("direct");

    const response = await validateRuleLinePurpose(sb, "t1", evolutionRule("meta_form"));

    expect(response?.status).toBe(409);
    const body = await response!.json();
    expect(body.code).toBe("line_purpose_mismatch");
    // slot_index 1 é a "Linha 2" para o operador.
    expect(body.error).toContain("Linha 2");
  });

  it("resolve a linha pelo phone_number_id quando o transporte é Cloud API", async () => {
    const sb = makeSb(null);
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "t1",
      slot_index: 1,
    });
    getSlotPurposeMock.mockResolvedValue("direct");

    const response = await validateRuleLinePurpose(sb, "t1", {
      source: "meta_form",
      connection_id: "123456789",
      transport: "cloud_api",
    });

    expect(lookupWhatsAppCloudConnectionByPhoneNumberIdMock).toHaveBeenCalledWith("123456789");
    expect(response?.status).toBe(409);
    expect(getSlotPurposeMock).toHaveBeenCalledWith("t1", 1);
  });

  it("não trava conexão Cloud de outro tenant — deixa o validador específico responder", async () => {
    const sb = makeSb(null);
    lookupWhatsAppCloudConnectionByPhoneNumberIdMock.mockResolvedValue({
      tenant_id: "outro-tenant",
      slot_index: 0,
    });

    const response = await validateRuleLinePurpose(sb, "t1", {
      source: "meta_form",
      connection_id: "123456789",
      transport: "cloud_api",
    });

    expect(response).toBeNull();
    expect(getSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("regra sem conexão passa direto — quem cobra conexão são os outros validadores", async () => {
    const sb = makeSb({ slot_index: 0 });
    getSlotPurposeMock.mockResolvedValue("forms");

    expect(
      await validateRuleLinePurpose(sb, "t1", { source: "whatsapp_organico", connection_id: "" }),
    ).toBeNull();
    expect(getSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("conexão inexistente não vira erro de finalidade", async () => {
    const sb = makeSb(null);

    expect(await validateRuleLinePurpose(sb, "t1", evolutionRule("meta_form"))).toBeNull();
    expect(getSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("origem sem finalidade não consulta nada", async () => {
    const sb = makeSb({ slot_index: 0 });

    expect(await validateRuleLinePurpose(sb, "t1", evolutionRule("other"))).toBeNull();
    expect(getSlotPurposeMock).not.toHaveBeenCalled();
  });
});
