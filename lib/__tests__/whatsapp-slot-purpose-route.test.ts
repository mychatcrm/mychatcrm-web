import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireActiveClientSessionMock,
  getExtraWhatsappSlotsMock,
  getEvolutionInstanceByTenantSlotMock,
  getWhatsAppCloudConnectionMock,
  setSlotPurposeMock,
  createSupabaseServiceClientMock,
} = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  getExtraWhatsappSlotsMock: vi.fn(),
  getEvolutionInstanceByTenantSlotMock: vi.fn(),
  getWhatsAppCloudConnectionMock: vi.fn(),
  setSlotPurposeMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({ requireActiveClientSession: requireActiveClientSessionMock }));
vi.mock("@/lib/server/whatsapp-extra-slots-db", () => ({ getExtraWhatsappSlots: getExtraWhatsappSlotsMock }));
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantSlot: getEvolutionInstanceByTenantSlotMock,
}));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({
  getWhatsAppCloudConnection: getWhatsAppCloudConnectionMock,
  lookupWhatsAppCloudConnectionByPhoneNumberId: vi.fn(),
}));
vi.mock("@/lib/server/whatsapp-slot-provider", () => ({
  setSlotPurpose: setSlotPurposeMock,
  getSlotPurpose: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: createSupabaseServiceClientMock }));

import { PATCH } from "@/app/api/client/whatsapp/slot-purpose/route";

type Rule = { id: string; name: string | null; source: string | null };

/** Regras retornadas para qualquer consulta de lead_distribution_rules. */
function mockRules(rules: Rule[]) {
  createSupabaseServiceClientMock.mockReturnValue({
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        then: (resolve: (value: { data: Rule[]; error: null }) => unknown) =>
          resolve({ data: rules, error: null }),
      };
      return query;
    }),
  });
}

function makeRequest(body: unknown) {
  return new Request("https://example.test/api/client/whatsapp/slot-purpose", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const session = { tenantId: "t1", plan: "equipa", operationalLimits: { includedWhatsAppLines: 2 } };

beforeEach(() => {
  vi.clearAllMocks();
  requireActiveClientSessionMock.mockResolvedValue({ ok: true, session });
  getExtraWhatsappSlotsMock.mockResolvedValue(0);
  getEvolutionInstanceByTenantSlotMock.mockResolvedValue({ id: "evo-uuid-1" });
  getWhatsAppCloudConnectionMock.mockResolvedValue(null);
  setSlotPurposeMock.mockResolvedValue({ error: null });
  mockRules([]);
});

describe("PATCH /api/client/whatsapp/slot-purpose", () => {
  it("trava a finalidade quando nenhuma regra conflita", async () => {
    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: "forms" }));

    expect(res.status).toBe(200);
    expect(setSlotPurposeMock).toHaveBeenCalledWith("t1", 0, "forms");
  });

  it("recusa travar como formulários quando há regra de WhatsApp direto na linha, nomeando a regra", async () => {
    mockRules([{ id: "rule-1", name: "Atendimento direto", source: "whatsapp_organico" }]);

    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: "forms" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("line_purpose_would_orphan_rules");
    expect(body.error).toContain("Atendimento direto");
    expect(body.rules).toEqual([{ id: "rule-1", name: "Atendimento direto" }]);
    expect(setSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("recusa travar como WhatsApp direto quando há regra de formulário na linha", async () => {
    mockRules([{ id: "rule-2", name: "[Recrutamento]", source: "meta_form" }]);

    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: "direct" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("[Recrutamento]");
    expect(setSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("libera quando as regras da linha já são da mesma finalidade", async () => {
    mockRules([{ id: "rule-3", name: "[Recrutamento]", source: "meta_form" }]);

    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: "forms" }));

    expect(res.status).toBe(200);
    expect(setSlotPurposeMock).toHaveBeenCalledWith("t1", 0, "forms");
  });

  // Destravar é a saída de emergência: nunca pode ser recusado, senão uma linha
  // travada por engano prende o operador junto com ela.
  it("destravar (null) passa mesmo com regras conflitantes", async () => {
    mockRules([{ id: "rule-4", name: "Atendimento direto", source: "whatsapp_organico" }]);

    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: null }));

    expect(res.status).toBe(200);
    expect(setSlotPurposeMock).toHaveBeenCalledWith("t1", 0, null);
  });

  it("recusa finalidade desconhecida", async () => {
    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: "qualquer" }));

    expect(res.status).toBe(400);
    expect(setSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("recusa linha fora da capacidade do plano", async () => {
    const res = await PATCH(makeRequest({ slotIndex: 7, purpose: "forms" }));

    expect(res.status).toBe(400);
    expect(setSlotPurposeMock).not.toHaveBeenCalled();
  });

  it("exige sessão ativa", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    const res = await PATCH(makeRequest({ slotIndex: 0, purpose: "forms" }));

    expect(res.status).toBe(401);
    expect(setSlotPurposeMock).not.toHaveBeenCalled();
  });
});
