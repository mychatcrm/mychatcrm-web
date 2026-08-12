import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evolutionLogoutInstanceMock,
  updateEvolutionInstanceStateByNameMock,
  notifyTenantIntegrationDisconnectedMock,
  findWhatsAppNumberOwnersMock,
} = vi.hoisted(() => ({
  evolutionLogoutInstanceMock: vi.fn(),
  updateEvolutionInstanceStateByNameMock: vi.fn(),
  notifyTenantIntegrationDisconnectedMock: vi.fn(),
  findWhatsAppNumberOwnersMock: vi.fn(),
}));

// Só o logout é falso: as funções de normalização de número são reais, porque
// é delas que depende a comparação que a trava faz.
vi.mock("@/lib/integrations/evolution-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/evolution-api")>(
    "@/lib/integrations/evolution-api",
  );
  return { ...actual, evolutionLogoutInstance: evolutionLogoutInstanceMock };
});
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  updateEvolutionInstanceStateByName: updateEvolutionInstanceStateByNameMock,
}));
vi.mock("@/lib/server/integration-disconnect-notifications", () => ({
  notifyTenantIntegrationDisconnected: notifyTenantIntegrationDisconnectedMock,
}));
vi.mock("@/lib/server/whatsapp-number-uniqueness", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/whatsapp-number-uniqueness")>(
    "@/lib/server/whatsapp-number-uniqueness",
  );
  return { ...actual, findWhatsAppNumberOwners: findWhatsAppNumberOwnersMock };
});

import { assertEvolutionWaJidUnique, findCloudNumberConflict } from "@/lib/server/whatsapp-number-guard";

beforeEach(() => {
  vi.clearAllMocks();
  findWhatsAppNumberOwnersMock.mockResolvedValue([]);
  evolutionLogoutInstanceMock.mockResolvedValue({ ok: true });
  updateEvolutionInstanceStateByNameMock.mockResolvedValue(undefined);
  notifyTenantIntegrationDisconnectedMock.mockResolvedValue(undefined);
});

describe("assertEvolutionWaJidUnique", () => {
  it("libera quando o número não pertence a nenhuma outra linha", async () => {
    const result = await assertEvolutionWaJidUnique({
      tenantId: "t1",
      slotIndex: 1,
      instanceName: "inst-nova",
      waJid: "5562991234567@s.whatsapp.net",
    });

    expect(result).toEqual({ ok: true });
    expect(evolutionLogoutInstanceMock).not.toHaveBeenCalled();
    expect(updateEvolutionInstanceStateByNameMock).not.toHaveBeenCalled();
  });

  it("derruba a sessão duplicada e não grava o jid quando o número já é da Linha 1", async () => {
    findWhatsAppNumberOwnersMock.mockResolvedValue([
      { kind: "evolution", tenantId: "t1", slotIndex: 0, connectionId: "evo-1", instanceName: "inst-antiga" },
    ]);

    const result = await assertEvolutionWaJidUnique({
      tenantId: "t1",
      slotIndex: 1,
      instanceName: "inst-nova",
      waJid: "5562991234567@s.whatsapp.net",
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("Linha 1");
    expect(evolutionLogoutInstanceMock).toHaveBeenCalledWith("inst-nova");
    // waJid null é o ponto crítico: o número duplicado não pode ficar gravado
    // nesta linha nem por um instante.
    expect(updateEvolutionInstanceStateByNameMock).toHaveBeenCalledWith({
      instanceName: "inst-nova",
      connectionState: "close",
      waJid: null,
      preserveLifecycle: true,
    });
    expect(notifyTenantIntegrationDisconnectedMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "whatsapp_number_duplicate" }),
    );
    // O aviso de WhatsApp tem que levar o MESMO motivo específico que a tela
    // mostraria — reconectar com o número duplicado derruba de novo, sempre,
    // então "reconecte a linha" sozinho (sem motivo) é instrução enganosa.
    const expectedMessage = result.ok === false ? result.message : undefined;
    expect(notifyTenantIntegrationDisconnectedMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonMessage: expectedMessage }),
    );
  });

  it("bloqueia número já usado por outra conta sem vazar dados dela", async () => {
    findWhatsAppNumberOwnersMock.mockResolvedValue([
      { kind: "cloud", tenantId: "outro-tenant", slotIndex: 2, connectionId: "999" },
    ]);

    const result = await assertEvolutionWaJidUnique({
      tenantId: "t1",
      slotIndex: 0,
      instanceName: "inst-nova",
      waJid: "5562991234567@s.whatsapp.net",
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("outra conta");
    expect(result.ok === false && result.message).not.toContain("outro-tenant");
  });

  // Reconectar a mesma linha com o mesmo número é operação normal.
  it("não acusa a própria linha como conflito", async () => {
    findWhatsAppNumberOwnersMock.mockResolvedValue([
      { kind: "cloud", tenantId: "t1", slotIndex: 0, connectionId: "123" },
    ]);

    const result = await assertEvolutionWaJidUnique({
      tenantId: "t1",
      slotIndex: 0,
      instanceName: "inst-atual",
      waJid: "5562991234567@s.whatsapp.net",
    });

    expect(result).toEqual({ ok: true });
    expect(evolutionLogoutInstanceMock).not.toHaveBeenCalled();
  });

  it("jid ilegível não bloqueia pareamento legítimo", async () => {
    const result = await assertEvolutionWaJidUnique({
      tenantId: "t1",
      slotIndex: 0,
      instanceName: "inst",
      waJid: "@s.whatsapp.net",
    });

    expect(result).toEqual({ ok: true });
    expect(findWhatsAppNumberOwnersMock).not.toHaveBeenCalled();
  });

  it("falha do logout não impede fechar a linha", async () => {
    findWhatsAppNumberOwnersMock.mockResolvedValue([
      { kind: "evolution", tenantId: "t1", slotIndex: 0, connectionId: "evo-1" },
    ]);
    evolutionLogoutInstanceMock.mockRejectedValue(new Error("evolution offline"));

    const result = await assertEvolutionWaJidUnique({
      tenantId: "t1",
      slotIndex: 1,
      instanceName: "inst-nova",
      waJid: "5562991234567@s.whatsapp.net",
    });

    expect(result.ok).toBe(false);
    expect(updateEvolutionInstanceStateByNameMock).toHaveBeenCalled();
  });
});

describe("findCloudNumberConflict", () => {
  it("acusa número já pareado por QR noutra linha", async () => {
    findWhatsAppNumberOwnersMock.mockResolvedValue([
      { kind: "evolution", tenantId: "t1", slotIndex: 0, connectionId: "evo-1" },
    ]);

    const conflict = await findCloudNumberConflict({
      tenantId: "t1",
      slotIndex: 1,
      displayPhone: "+55 62 99123-4567",
    });

    expect(conflict?.message).toContain("Linha 1");
  });

  // A leitura do número na Graph é best-effort: sem ela, não travar onboarding.
  it("sem display_phone não consulta nem bloqueia", async () => {
    const conflict = await findCloudNumberConflict({
      tenantId: "t1",
      slotIndex: 1,
      displayPhone: null,
    });

    expect(conflict).toBeNull();
    expect(findWhatsAppNumberOwnersMock).not.toHaveBeenCalled();
  });

  it("não acusa a própria linha", async () => {
    findWhatsAppNumberOwnersMock.mockResolvedValue([
      { kind: "cloud", tenantId: "t1", slotIndex: 1, connectionId: "123" },
    ]);

    const conflict = await findCloudNumberConflict({
      tenantId: "t1",
      slotIndex: 1,
      displayPhone: "+55 62 99123-4567",
    });

    expect(conflict).toBeNull();
  });
});
