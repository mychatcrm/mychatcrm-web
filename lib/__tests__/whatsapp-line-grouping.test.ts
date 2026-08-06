import { describe, expect, it } from "vitest";
import { groupWhatsappLinesByPurpose } from "@/lib/whatsapp-line-grouping";

describe("groupWhatsappLinesByPurpose", () => {
  it("caso comum: 1 linha por seção", () => {
    const result = groupWhatsappLinesByPurpose([
      { slotIndex: 0, purpose: "forms", connected: true },
      { slotIndex: 1, purpose: "direct", connected: true },
    ]);

    expect(result).toEqual({ forms: [0], direct: [1], pendingWithConnection: [], freeCapacity: 0 });
  });

  it("linha extra: 2 linhas na mesma seção", () => {
    const result = groupWhatsappLinesByPurpose([
      { slotIndex: 0, purpose: "direct", connected: true },
      { slotIndex: 1, purpose: "direct", connected: true },
      { slotIndex: 2, purpose: "forms", connected: false },
    ]);

    expect(result.direct).toEqual([0, 1]);
    expect(result.forms).toEqual([2]);
  });

  it("linha sem finalidade mas já conectada cai na faixa separada, não numa seção normal", () => {
    const result = groupWhatsappLinesByPurpose([{ slotIndex: 0, purpose: null, connected: true }]);

    expect(result).toEqual({ forms: [], direct: [], pendingWithConnection: [0], freeCapacity: 0 });
  });

  it("linha sem finalidade e sem conexão conta como capacidade livre, não aparece em lugar nenhum", () => {
    const result = groupWhatsappLinesByPurpose([
      { slotIndex: 0, purpose: "forms", connected: true },
      { slotIndex: 1, purpose: null, connected: false },
    ]);

    expect(result.forms).toEqual([0]);
    expect(result.direct).toEqual([]);
    expect(result.pendingWithConnection).toEqual([]);
    expect(result.freeCapacity).toBe(1);
  });

  it("nunca perde uma linha — soma das categorias bate com o total de entrada", () => {
    const lines = [
      { slotIndex: 0, purpose: "forms" as const, connected: true },
      { slotIndex: 1, purpose: "direct" as const, connected: true },
      { slotIndex: 2, purpose: null, connected: true },
      { slotIndex: 3, purpose: null, connected: false },
      { slotIndex: 4, purpose: "forms" as const, connected: false },
    ];

    const result = groupWhatsappLinesByPurpose(lines);

    const accounted = result.forms.length + result.direct.length + result.pendingWithConnection.length + result.freeCapacity;
    expect(accounted).toBe(lines.length);
  });

  it("devolve as listas ordenadas por slotIndex mesmo com entrada fora de ordem", () => {
    const result = groupWhatsappLinesByPurpose([
      { slotIndex: 2, purpose: "direct", connected: true },
      { slotIndex: 0, purpose: "direct", connected: true },
      { slotIndex: 1, purpose: "direct", connected: true },
    ]);

    expect(result.direct).toEqual([0, 1, 2]);
  });

  it("lista vazia devolve tudo vazio", () => {
    expect(groupWhatsappLinesByPurpose([])).toEqual({
      forms: [],
      direct: [],
      pendingWithConnection: [],
      freeCapacity: 0,
    });
  });
});
