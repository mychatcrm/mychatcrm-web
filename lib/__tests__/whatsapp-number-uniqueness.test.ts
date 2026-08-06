import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: createSupabaseServiceClientMock }));

import {
  describeNumberConflict,
  findWhatsAppNumberOwners,
  isSameWhatsAppNumber,
  normalizeWhatsAppNumberKey,
  whatsAppNumberKeyVariants,
} from "@/lib/server/whatsapp-number-uniqueness";

type EvoRow = {
  id: string;
  tenant_id: string;
  slot_index: number;
  instance_name: string;
  wa_jid: string | null;
};
type CloudRow = {
  tenant_id: string;
  slot_index: number;
  phone_number_id: string;
  display_phone: string | null;
};

/** `.or()` é aproximado: devolve todas as linhas e deixa a checagem fina pro código. */
function mockTables(evo: EvoRow[], cloud: CloudRow[]) {
  createSupabaseServiceClientMock.mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        or: () => Promise.resolve({ data: evo, error: null }),
        eq: () => Promise.resolve({ data: cloud, error: null }),
      }),
      _table: table,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTables([], []);
});

describe("normalizeWhatsAppNumberKey", () => {
  it("extrai dígitos de JID comum e de @lid", () => {
    expect(normalizeWhatsAppNumberKey("5562991234567@s.whatsapp.net")).toBe("5562991234567");
    expect(normalizeWhatsAppNumberKey("5562991234567@lid")).toBe("5562991234567");
  });

  it("normaliza o formato humano que a Meta guarda em display_phone", () => {
    expect(normalizeWhatsAppNumberKey("+55 62 99123-4567")).toBe("5562991234567");
  });

  it("acrescenta o 9º dígito em móvel brasileiro sem ele", () => {
    expect(normalizeWhatsAppNumberKey("556291234567")).toBe("5562991234567");
  });

  it("descarta entrada vazia ou curta demais", () => {
    expect(normalizeWhatsAppNumberKey(null)).toBeNull();
    expect(normalizeWhatsAppNumberKey("   ")).toBeNull();
    expect(normalizeWhatsAppNumberKey("123")).toBeNull();
  });
});

describe("whatsAppNumberKeyVariants", () => {
  it("gera a variante sem o 9 para móvel brasileiro", () => {
    expect(whatsAppNumberKeyVariants("5562991234567")).toEqual(["5562991234567", "556291234567"]);
  });

  it("número sem variante alternativa devolve só ele mesmo", () => {
    expect(whatsAppNumberKeyVariants("12025550100")).toEqual(["12025550100"]);
  });
});

describe("isSameWhatsAppNumber", () => {
  it("mesma linha escrita com e sem o 9 é o mesmo número", () => {
    expect(isSameWhatsAppNumber("5562991234567@s.whatsapp.net", "556291234567")).toBe(true);
  });

  it("display_phone da Meta casa com o JID do QR", () => {
    expect(isSameWhatsAppNumber("+55 62 99123-4567", "5562991234567@s.whatsapp.net")).toBe(true);
  });

  it("números diferentes não casam", () => {
    expect(isSameWhatsAppNumber("5562991234567", "5562997654321")).toBe(false);
  });

  it("entrada inválida nunca casa", () => {
    expect(isSameWhatsAppNumber(null, "5562991234567")).toBe(false);
  });
});

describe("findWhatsAppNumberOwners", () => {
  it("encontra o mesmo número já pareado noutra linha do mesmo tenant", async () => {
    mockTables(
      [
        {
          id: "evo-1",
          tenant_id: "t1",
          slot_index: 0,
          instance_name: "inst-antiga",
          wa_jid: "5562991234567@s.whatsapp.net",
        },
      ],
      [],
    );

    const owners = await findWhatsAppNumberOwners({ numberKey: "5562991234567" });

    expect(owners).toEqual([
      { kind: "evolution", tenantId: "t1", slotIndex: 0, connectionId: "evo-1", instanceName: "inst-antiga" },
    ]);
  });

  it("pega o cruzamento QR ↔ API Meta pelo número físico", async () => {
    mockTables([], [
      { tenant_id: "t1", slot_index: 1, phone_number_id: "123456", display_phone: "+55 62 99123-4567" },
    ]);

    const owners = await findWhatsAppNumberOwners({ numberKey: "5562991234567" });

    expect(owners).toEqual([{ kind: "cloud", tenantId: "t1", slotIndex: 1, connectionId: "123456" }]);
  });

  it("casa a variante sem o 9 gravada na outra linha", async () => {
    mockTables(
      [{ id: "evo-1", tenant_id: "t1", slot_index: 0, instance_name: "inst", wa_jid: "556291234567@s.whatsapp.net" }],
      [],
    );

    expect(await findWhatsAppNumberOwners({ numberKey: "5562991234567" })).toHaveLength(1);
  });

  // Reconectar a mesma linha é operação normal e não pode se acusar de duplicata.
  it("ignora a própria instância que está re-pareando", async () => {
    mockTables(
      [{ id: "evo-1", tenant_id: "t1", slot_index: 0, instance_name: "inst-atual", wa_jid: "5562991234567@s.whatsapp.net" }],
      [],
    );

    const owners = await findWhatsAppNumberOwners({
      numberKey: "5562991234567",
      excludeEvolutionInstanceName: "inst-atual",
    });

    expect(owners).toEqual([]);
  });

  it("ignora a própria linha Cloud que está reconectando", async () => {
    mockTables([], [
      { tenant_id: "t1", slot_index: 1, phone_number_id: "123456", display_phone: "+55 62 99123-4567" },
    ]);

    const owners = await findWhatsAppNumberOwners({
      numberKey: "5562991234567",
      excludeCloud: { tenantId: "t1", slotIndex: 1 },
    });

    expect(owners).toEqual([]);
  });

  // O `like` do banco casa prefixo; um número mais longo com o mesmo começo
  // não pode ser tratado como duplicata.
  it("não confunde número mais longo com o mesmo prefixo", async () => {
    mockTables(
      [{ id: "evo-1", tenant_id: "t1", slot_index: 0, instance_name: "inst", wa_jid: "556299123456700@s.whatsapp.net" }],
      [],
    );

    expect(await findWhatsAppNumberOwners({ numberKey: "5562991234567" })).toEqual([]);
  });

  it("número livre não tem dono", async () => {
    expect(await findWhatsAppNumberOwners({ numberKey: "5562997654321" })).toEqual([]);
  });
});

describe("describeNumberConflict", () => {
  it("nomeia a linha quando o número é da própria conta", () => {
    const message = describeNumberConflict(
      { kind: "evolution", tenantId: "t1", slotIndex: 0, connectionId: "evo-1" },
      "t1",
    );
    expect(message).toContain("Linha 1");
  });

  it("nunca revela nada da outra conta", () => {
    const message = describeNumberConflict(
      { kind: "evolution", tenantId: "outro-tenant", slotIndex: 3, connectionId: "evo-9" },
      "t1",
    );
    expect(message).toContain("outra conta");
    expect(message).not.toContain("outro-tenant");
    expect(message).not.toContain("Linha 4");
  });
});
